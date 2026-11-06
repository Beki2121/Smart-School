import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { auditRow, organizationAdministratorConflict, planLimitError, setupConflict } from '../shared.js';
import { toMysqlDateTime } from '../platform.mappers.js';

export const mysqlAccountsBundle = {
  async assertUserCapacity(organizationId, additional = 1, excludedTarget = null, query = this.db) {
    const organization = await query('organizations').where({ id: organizationId })
      .forUpdate().first('id');
    if (!organization) return;
    const plan = await query('organization_subscriptions as os')
      .join('subscription_plans as sp', 'sp.id', 'os.plan_id')
      .where('os.organization_id', organizationId).orderBy('os.created_at', 'desc')
      .first('sp.max_users');
    if (plan?.max_users == null) return;
    const activeUsers = await query('users').where({
      organization_id: organizationId, is_active: true
    }).count({ total: '*' }).first();
    const pendingQuery = query('account_invitations')
      .where({ organization_id: organizationId }).whereNull('accepted_at')
      .where('expires_at', '>', query.fn.now());
    if (excludedTarget) pendingQuery.whereNot({
      target_type: excludedTarget.targetType, target_id: excludedTarget.targetId
    });
    const pending = await pendingQuery.count({ total: '*' }).first();
    if (Number(activeUsers.total) + Number(pending.total) + additional > Number(plan.max_users)) {
      throw planLimitError('user', Number(plan.max_users));
    }
  },
  async findUserByLogin(login) {
    const normalizedLogin = login.toLowerCase();
    const user = await this.db('users as u')
      .join('organizations as o', 'o.id', 'u.organization_id')
      .select('u.*', 'o.status as organization_status')
      .where(function () {
        this.whereRaw('LOWER(u.email) = ?', [normalizedLogin])
          .orWhereRaw('LOWER(u.username) = ?', [normalizedLogin])
          .orWhere({ 'u.phone': login });
    }).first();
    if (!user) return null;
    const memberships = await this.db('user_campuses as uc')
      .join('campuses as c', 'c.id', 'uc.campus_id')
      .where({
        'uc.user_id': user.id, 'uc.is_active': true,
        'c.organization_id': user.organization_id, 'c.is_active': true
      })
      .select('uc.campus_id');
    return {
      id: user.id, orgId: user.organization_id, name: user.name, email: user.email,
      phone: user.phone, passwordHash: user.password_hash, role: user.role,
      campusIds: memberships.map((m) => m.campus_id), activeCampusId: memberships[0]?.campus_id,
      authVersion: Number(user.auth_version ?? 0),
      emailVerifiedAt: user.email_verified_at,
      isActive: Boolean(user.is_active),
      mustChangePassword: Boolean(user.must_change_password)
    };
  },
  async findUserById(id) {
    const user = await this.db('users as u')
      .join('organizations as o', 'o.id', 'u.organization_id')
      .select('u.*', 'o.status as organization_status').where('u.id', id).first();
    if (!user) return null;
    const memberships = await this.db('user_campuses as uc')
      .join('campuses as c', 'c.id', 'uc.campus_id')
      .where({
        'uc.user_id': id, 'uc.is_active': true,
        'c.organization_id': user.organization_id, 'c.is_active': true
      })
      .select('uc.campus_id');
    return {
      id: user.id, orgId: user.organization_id, name: user.name, email: user.email,
      role: user.role, campusIds: memberships.map((m) => m.campus_id),
      activeCampusId: memberships[0]?.campus_id,
      authVersion: Number(user.auth_version ?? 0),
      emailVerifiedAt: user.email_verified_at,
      accountActive: Boolean(user.is_active),
      isActive: Boolean(user.is_active) &&
        (['super_admin', 'support_staff'].includes(user.role) ||
          user.organization_status === 'active'),
      mustChangePassword: Boolean(user.must_change_password)
    };
  },
  async createAccountInvitation(invitation, actor) {
    const existingUser = await this.db('users')
      .whereRaw('LOWER(email) = ?', [invitation.email.toLowerCase()]).first('id');
    if (existingUser) throw setupConflict('An account already uses this email address.');
    const target = await this.getInvitationTarget({
      ...invitation, organization_id: actor.orgId, campus_id: actor.activeCampusId,
      target_type: invitation.targetType, target_id: invitation.targetId,
      target_name: invitation.targetName ?? null
    });
    if (!target) throw setupConflict('The selected person is not eligible for an account invitation.');
    const record = {
      id: invitation.id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
      email: invitation.email, role: invitation.role, target_type: invitation.targetType,
      target_id: invitation.targetId, target_name: invitation.targetName ?? null,
      token_hash: invitation.tokenHash,
      expires_at: toMysqlDateTime(invitation.expiresAt), accepted_at: null, created_by: actor.sub
    };
    await this.db.transaction(async (trx) => {
      if (invitation.targetType !== 'platform_administrator') {
        await this.assertUserCapacity(actor.orgId, 1, {
          targetType: invitation.targetType, targetId: invitation.targetId
        }, trx);
      }
      await trx('account_invitations').where({
        organization_id: actor.orgId, target_type: invitation.targetType, target_id: invitation.targetId
      }).whereNull('accepted_at').update({ expires_at: trx.fn.now() });
      await trx('account_invitations').insert(record);
      await trx('audit_log').insert(auditRow(actor, 'account_invitation.created',
        'account_invitation', invitation.id, null, {
          email: invitation.email, role: invitation.role, targetType: invitation.targetType,
          targetId: invitation.targetId, expiresAt: invitation.expiresAt
        }));
    });
    return { id: invitation.id, email: invitation.email, role: invitation.role, name: target.name, expiresAt: invitation.expiresAt };
  },
  async regenerateSchoolAdministratorInvitation(organizationId, invitation, actor) {
    return this.db.transaction(async (trx) => {
      const organization = await trx('organizations').where({
        id: organizationId, status: 'active'
      }).forUpdate().first('id', 'name');
      if (!organization) return null;
      const owner = await trx('users').where({
        organization_id: organizationId, role: 'owner_director'
      }).first('id');
      if (owner) return null;
      const previous = await trx('account_invitations').where({
        organization_id: organizationId, target_type: 'school_administrator',
        target_id: organizationId
      }).whereNull('accepted_at').orderBy('created_at', 'desc').forUpdate().first();
      if (!previous) return null;
      const existingUser = await trx('users')
        .whereRaw('LOWER(email) = ?', [previous.email.toLowerCase()]).first('id');
      if (existingUser) return null;
      const campus = await trx('campuses').where({
        organization_id: organizationId, is_active: true
      }).orderBy('created_at').first('id');
      if (!campus) return null;
      await trx('account_invitations').where({
        organization_id: organizationId, target_type: 'school_administrator',
        target_id: organizationId
      }).whereNull('accepted_at').update({ expires_at: trx.fn.now() });
      await trx('account_invitations').insert({
        id: invitation.id, organization_id: organizationId, campus_id: campus.id,
        email: previous.email, role: 'owner_director',
        target_type: 'school_administrator', target_id: organizationId,
        target_name: previous.target_name || organization.name,
        token_hash: invitation.tokenHash, expires_at: toMysqlDateTime(invitation.expiresAt),
        accepted_at: null, created_by: actor.sub
      });
      await trx('audit_log').insert(auditRow(actor, 'account_invitation.regenerated',
        'account_invitation', invitation.id, null, {
          email: previous.email, targetType: 'school_administrator',
          targetId: organizationId, expiresAt: invitation.expiresAt
        }));
      return {
        id: invitation.id, email: previous.email, role: 'owner_director',
        name: previous.target_name || organization.name, expiresAt: invitation.expiresAt
      };
    });
  },
  async getInvitationTarget(invitation, query = this.db) {
    if (invitation.target_type === 'platform_administrator') {
      return invitation.organization_id === '00000000-0000-4000-8000-000000000001' &&
        invitation.target_id === invitation.organization_id && invitation.role === 'super_admin'
        ? { name: invitation.target_name }
        : null;
    }
    if (invitation.target_type === 'school_administrator') {
      if (invitation.target_id !== invitation.organization_id ||
          invitation.role !== 'owner_director') return null;
      const organization = await query('organizations').where({
        id: invitation.organization_id, status: 'active'
      }).first('id', 'name');
      const campus = await query('campuses').where({
        id: invitation.campus_id, organization_id: invitation.organization_id,
        is_active: true
      }).first('id');
      return organization && campus
        ? { name: invitation.target_name || organization.name }
        : null;
    }
    if (invitation.target_type === 'staff') {
      const target = await query('staff').where({
        id: invitation.target_id, campus_id: invitation.campus_id
      }).whereNot('employment_status', 'terminated')
        .whereNull('archived_at').whereNull('user_id').first();
      return target ? { name: `${target.given_name_en} ${target.father_name_en} ${target.grandfather_name_en}` } : null;
    }
    if (invitation.target_type === 'student') {
      const target = await query('students').where({
        id: invitation.target_id, campus_id: invitation.campus_id, status: 'enrolled'
      }).whereNull('archived_at').whereNull('user_id').first();
      return target ? { name: `${target.given_name_en} ${target.father_name_en} ${target.grandfather_name_en}` } : null;
    }
    const guardian = await query('guardians').where({
      id: invitation.target_id, organization_id: invitation.organization_id
    }).whereNull('user_id').first();
    if (!guardian || !guardian.email || guardian.email.toLowerCase() !== invitation.email.toLowerCase()) return null;
    const verifiedLink = await query('student_guardians as sg')
      .join('students as s', 's.id', 'sg.student_id')
      .where({
        'sg.guardian_id': invitation.target_id, 'sg.is_verified': true,
        's.campus_id': invitation.campus_id
      }).whereNull('s.archived_at').first('sg.guardian_id');
    return verifiedLink
      ? { name: `${guardian.given_name_en} ${guardian.father_name_en} ${guardian.grandfather_name_en}` }
      : null;
  },
  async getAccountInvitation(tokenHash) {
    const invitation = await this.db('account_invitations').where({
      token_hash: tokenHash
    }).whereNull('accepted_at').where('expires_at', '>', this.db.fn.now()).first();
    if (!invitation) return null;
    const target = await this.getInvitationTarget(invitation);
    return target ? {
      email: invitation.email, role: invitation.role, name: target.name,
      expiresAt: invitation.expires_at
    } : null;
  },
  async acceptAccountInvitation(tokenHash, passwordHash) {
    return this.db.transaction(async (trx) => {
      const invitation = await trx('account_invitations').where({
        token_hash: tokenHash
      }).whereNull('accepted_at').where('expires_at', '>', trx.fn.now()).forUpdate().first();
      if (!invitation) return null;
      const target = await this.getInvitationTarget(invitation, trx);
      if (!target) return null;
      const existing = await trx('users').whereRaw('LOWER(email) = ?', [invitation.email.toLowerCase()]).first('id');
      if (existing) throw setupConflict('An account already uses this email address.');
      if (invitation.target_type !== 'platform_administrator') {
        await this.assertUserCapacity(invitation.organization_id, 1, {
          targetType: invitation.target_type, targetId: invitation.target_id
        }, trx);
      }
      const id = randomUUID();
      const campusIds = invitation.target_type === 'platform_administrator'
        ? []
        : invitation.target_type === 'school_administrator'
        ? (await trx('campuses').where({
          organization_id: invitation.organization_id, is_active: true
        }).orderBy('created_at').select('id')).map((campus) => campus.id)
        : invitation.target_type === 'guardian'
        ? (await trx('student_guardians as sg')
          .join('students as s', 's.id', 'sg.student_id')
          .join('campuses as c', 'c.id', 's.campus_id')
          .where({
            'sg.guardian_id': invitation.target_id, 'sg.is_verified': true,
            'c.organization_id': invitation.organization_id, 'c.is_active': true
          }).whereNull('s.archived_at').distinct('s.campus_id').select('s.campus_id'))
          .map((item) => item.campus_id)
        : [invitation.campus_id];
      if (invitation.target_type !== 'platform_administrator' &&
          !campusIds.includes(invitation.campus_id)) return null;
      await trx('users').insert({
        id, organization_id: invitation.organization_id, name: target.name, email: invitation.email,
        password_hash: passwordHash, role: invitation.role, is_active: true,
        email_verified_at: trx.fn.now()
      });
      if (campusIds.length) await trx('user_campuses').insert(campusIds.map((campusId) => ({
        user_id: id, campus_id: campusId, is_active: true
      })));
      if (!['school_administrator', 'platform_administrator'].includes(invitation.target_type)) {
        const targetTable = invitation.target_type === 'staff' ? 'staff'
          : invitation.target_type === 'student' ? 'students' : 'guardians';
        const updated = await trx(targetTable).where({
          id: invitation.target_id, user_id: null
        }).update({ user_id: id });
        if (!updated) throw setupConflict('This person already has an account.');
      }
      await trx('account_invitations').where({ id: invitation.id, accepted_at: null })
        .update({ accepted_at: trx.fn.now() });
      await trx('audit_log').insert(auditRow({
        sub: id, orgId: invitation.organization_id, activeCampusId: invitation.campus_id
      }, 'account_invitation.accepted', 'user', id, null, {
        email: invitation.email, role: invitation.role,
        targetType: invitation.target_type, targetId: invitation.target_id
      }));
      return {
        id, orgId: invitation.organization_id, name: target.name, email: invitation.email,
        phone: null, passwordHash, role: invitation.role, campusIds,
        activeCampusId: invitation.campus_id, isActive: true,
        emailVerifiedAt: new Date().toISOString()
      };
    });
  },
  async recordLoginFailure(login) {
    const item = this.loginFailures.get(login) ?? { count: 0, since: Date.now() };
    if (Date.now() - item.since > 15 * 60_000) { item.count = 0; item.since = Date.now(); }
    item.count += 1; this.loginFailures.set(login, item);
    return item.count;
  },
  async clearLoginFailures(login) { this.loginFailures.delete(login); },
  async changePassword(userId, currentPassword, newPassword, actor) {
    const changed = await this.db.transaction(async (trx) => {
      const user = await trx('users').where({ id: userId }).forUpdate().first();
      if (!user || !user.is_active || !await bcrypt.compare(currentPassword, user.password_hash)) return false;
      if (await bcrypt.compare(newPassword, user.password_hash)) {
        throw setupConflict('Choose a password different from your temporary password.');
      }
      await trx('users').where({ id: userId }).update({
        password_hash: await bcrypt.hash(newPassword, 12), must_change_password: false,
        auth_version: trx.raw('auth_version + 1')
      });
      await trx('refresh_tokens').where({ user_id: userId }).whereNull('revoked_at')
        .update({ revoked_at: trx.fn.now() });
      await trx('auth_sessions').where({ user_id: userId }).whereNull('revoked_at')
        .update({ revoked_at: trx.fn.now() });
      await trx('audit_log').insert(auditRow(actor, 'user.password_changed', 'user', userId, null, null));
      return true;
    });
    return changed ? this.findUserById(userId) : null;
  },
  async createPasswordReset(email, tokenHash, expiresAt) {
    return this.db.transaction(async (trx) => {
      const user = await trx('users').whereRaw('LOWER(email) = ?', [email.toLowerCase()])
        .where({ is_active: true }).first('id', 'organization_id', 'name', 'email');
      if (!user) return null;
      await trx('password_reset_tokens').where({ user_id: user.id })
        .whereNull('consumed_at').update({ consumed_at: trx.fn.now() });
      await trx('password_reset_tokens').insert({
        id: randomUUID(), user_id: user.id, token_hash: tokenHash, expires_at: expiresAt
      });
      await trx('audit_log').insert(auditRow({
        sub: user.id, orgId: user.organization_id, activeCampusId: null
      }, 'auth.password_reset_requested', 'user', user.id, null, null));
      return { userId: user.id, name: user.name, email: user.email };
    });
  },
  async revokePasswordResetToken(tokenHash) {
    await this.db('password_reset_tokens').where({ token_hash: tokenHash })
      .whereNull('consumed_at').update({ consumed_at: this.db.fn.now() });
  },
  async completePasswordReset(tokenHash, passwordHash) {
    return this.db.transaction(async (trx) => {
      const reset = await trx('password_reset_tokens').where({
        token_hash: tokenHash
      }).whereNull('consumed_at').where('expires_at', '>', trx.fn.now())
        .forUpdate().first();
      if (!reset) return null;
      const user = await trx('users').where({
        id: reset.user_id, is_active: true
      }).forUpdate().first();
      await trx('password_reset_tokens').where({ id: reset.id })
        .update({ consumed_at: trx.fn.now() });
      if (!user) return null;
      await trx('users').where({ id: user.id }).update({
        password_hash: passwordHash, must_change_password: false,
        auth_version: trx.raw('auth_version + 1')
      });
      await trx('password_reset_tokens').where({ user_id: user.id })
        .whereNull('consumed_at').update({ consumed_at: trx.fn.now() });
      await trx('refresh_tokens').where({ user_id: user.id }).whereNull('revoked_at')
        .update({ revoked_at: trx.fn.now() });
      await trx('auth_sessions').where({ user_id: user.id }).whereNull('revoked_at')
        .update({ revoked_at: trx.fn.now() });
      await trx('audit_log').insert(auditRow({
        sub: user.id, orgId: user.organization_id, activeCampusId: null
      }, 'auth.password_reset_completed', 'user', user.id, null, null));
      return { id: user.id };
    });
  },
  async storeRefreshToken(tokenHash, userId, expiresAt, campusId = null, sessionId, metadata = {}) {
    const id = sessionId ?? randomUUID();
    await this.db.transaction(async (trx) => {
      const existing = await trx('auth_sessions').where({ id }).first('id', 'revoked_at');
      if (existing?.revoked_at) {
        const error = new Error('This session is no longer valid. Sign in again.');
        error.status = 401;
        error.code = 'SESSION_REVOKED';
        throw error;
      }
      const user = await trx('users').where({ id: userId }).first('organization_id');
      if (!user) return;
      const sessionValues = {
        user_id: userId, organization_id: user.organization_id, campus_id: campusId,
        ip_address: existing ? undefined : metadata.ipAddress ?? null,
        user_agent: existing ? undefined : metadata.userAgent ?? null,
        last_seen_at: trx.fn.now(), expires_at: expiresAt
      };
      if (existing) {
        delete sessionValues.ip_address;
        delete sessionValues.user_agent;
        await trx('auth_sessions').where({ id }).update(sessionValues);
      } else {
        await trx('auth_sessions').insert({ id, ...sessionValues });
      }
      await trx('refresh_tokens').insert({
        id: randomUUID(), user_id: userId, token_hash: tokenHash, expires_at: expiresAt,
        campus_id: campusId, session_id: id
      });
    });
  },
  async consumeRefreshToken(tokenHash) {
    return this.db.transaction(async (trx) => {
      const row = await trx('refresh_tokens').where({ token_hash: tokenHash }).forUpdate().first();
      if (!row || row.revoked_at || new Date(row.expires_at) <= new Date()) return null;
      await trx('refresh_tokens').where({ id: row.id }).update({ revoked_at: trx.fn.now() });
      const user = await trx('users').where({ id: row.user_id }).first();
      if (!user || !user.is_active) return null;
      const memberships = await trx('user_campuses as uc')
        .join('campuses as c', 'c.id', 'uc.campus_id')
        .where({
          'uc.user_id': user.id, 'uc.is_active': true,
          'c.organization_id': user.organization_id, 'c.is_active': true
        })
        .select('uc.campus_id');
      const activeCampusId = row.campus_id
        ? memberships.find((membership) => membership.campus_id === row.campus_id)?.campus_id
        : memberships[0]?.campus_id;
      return {
        id: user.id, orgId: user.organization_id, name: user.name, email: user.email,
        role: user.role, campusIds: memberships.map((m) => m.campus_id),
        activeCampusId: row.campus_id ?? activeCampusId,
        branchActive: !row.campus_id || Boolean(activeCampusId),
        isActive: Boolean(user.is_active),
        authVersion: Number(user.auth_version ?? 0),
        mustChangePassword: Boolean(user.must_change_password),
        sessionId: row.session_id ?? null,
        sessionMetadata: {
          ipAddress: row.session_id ? (await trx('auth_sessions').where({ id: row.session_id }).first('ip_address'))?.ip_address ?? null : null,
          userAgent: row.session_id ? (await trx('auth_sessions').where({ id: row.session_id }).first('user_agent'))?.user_agent ?? null : null
        }
      };
    });
  },
  async switchRefreshTokenCampus(tokenHash, userId, campusId, nextTokenHash, expiresAt, actor, sessionId) {
    return this.db.transaction(async (trx) => {
      const row = await trx('refresh_tokens').where({
        token_hash: tokenHash, user_id: userId
      }).forUpdate().first();
      if (!row || row.revoked_at || new Date(row.expires_at) <= new Date()) return null;
      const user = await trx('users').where({ id: userId, is_active: true }).first();
      if (!user || user.role === 'super_admin') return null;
      const membership = await trx('user_campuses as uc')
        .join('campuses as c', 'c.id', 'uc.campus_id')
        .where({
          'uc.user_id': userId, 'uc.campus_id': campusId, 'uc.is_active': true,
          'c.organization_id': user.organization_id, 'c.is_active': true
        }).first('uc.campus_id');
      if (!membership) return null;
        const activeSessionId = row.session_id ?? sessionId ?? randomUUID();
        const existingSession = await trx('auth_sessions').where({ id: activeSessionId })
          .first('id', 'revoked_at');
        if (existingSession?.revoked_at) return null;
        await trx('refresh_tokens').where({ id: row.id }).update({ revoked_at: trx.fn.now() });
        const sessionValues = {
          user_id: userId, organization_id: user.organization_id, campus_id: campusId,
          last_seen_at: trx.fn.now(), expires_at: expiresAt, revoked_at: null
      };
      if (existingSession) await trx('auth_sessions').where({ id: activeSessionId }).update(sessionValues);
      else await trx('auth_sessions').insert({ id: activeSessionId, ...sessionValues });
      await trx('refresh_tokens').insert({
        id: randomUUID(), user_id: userId, token_hash: nextTokenHash,
        expires_at: expiresAt, campus_id: campusId, session_id: activeSessionId
      });
      await trx('audit_log').insert(auditRow({
        ...actor, activeCampusId: campusId
      }, 'auth.branch_switched', 'campus', campusId,
      { activeCampusId: actor.activeCampusId }, { activeCampusId: campusId }));
      const memberships = await trx('user_campuses as uc')
        .join('campuses as c', 'c.id', 'uc.campus_id')
        .where({
          'uc.user_id': userId, 'uc.is_active': true,
          'c.organization_id': user.organization_id, 'c.is_active': true
        }).select('uc.campus_id');
      return {
        id: user.id, orgId: user.organization_id, name: user.name, email: user.email,
        role: user.role, campusIds: memberships.map((item) => item.campus_id),
        activeCampusId: campusId, isActive: Boolean(user.is_active), sessionId: activeSessionId,
        authVersion: Number(user.auth_version ?? 0),
        mustChangePassword: Boolean(user.must_change_password)
      };
    });
  },
  async revokeRefreshToken(tokenHash) {
    const token = await this.db('refresh_tokens').where({ token_hash: tokenHash })
      .whereNull('revoked_at').first('user_id', 'session_id');
    if (!token) return null;
    await this.db.transaction(async (trx) => {
      await trx('refresh_tokens').where({ token_hash: tokenHash })
        .whereNull('revoked_at').update({ revoked_at: trx.fn.now() });
      if (token.session_id) {
        await trx('auth_sessions').where({ id: token.session_id }).whereNull('revoked_at')
          .update({ revoked_at: trx.fn.now() });
      }
    });
    return this.findUserById(token.user_id);
  },
  async listOrganizationAccounts(organizationId) {
    const users = await this.db('users')
      .where({ organization_id: organizationId })
      .whereNot('role', 'super_admin')
      .orderBy('name')
      .select('id', 'name', 'email', 'role', 'is_active');
    if (!users.length) return [];
    const memberships = await this.db('user_campuses as uc')
      .join('campuses as c', 'c.id', 'uc.campus_id')
      .whereIn('uc.user_id', users.map((user) => user.id))
      .where({ 'uc.is_active': true, 'c.organization_id': organizationId })
      .select('uc.user_id', 'uc.campus_id');
    const campusesByUser = new Map();
    for (const membership of memberships) {
      const campuses = campusesByUser.get(membership.user_id) ?? [];
      campuses.push(membership.campus_id);
      campusesByUser.set(membership.user_id, campuses);
    }
    return users.map((user) => ({
      id: user.id, name: user.name, email: user.email, role: user.role,
      isActive: Boolean(user.is_active), campusIds: campusesByUser.get(user.id) ?? []
    }));
  },
  async setOrganizationAccountStatus(organizationId, userId, isActive, actor) {
    return this.db.transaction(async (trx) => {
      await trx('organizations').where({ id: organizationId }).forUpdate().first('id');
      const user = await trx('users').where({
        id: userId, organization_id: organizationId
      }).whereNot('role', 'super_admin').forUpdate().first('id', 'role', 'is_active');
      if (!user) return null;
      if (user.role === 'owner_director' && user.is_active && !isActive) {
        const activeAdministrators = await trx('users').where({
          organization_id: organizationId, role: 'owner_director', is_active: true
        }).forUpdate().select('id');
        if (activeAdministrators.length <= 1) throw organizationAdministratorConflict();
      }
      if (userId === actor.sub && !isActive) {
        throw setupConflict('You cannot deactivate your own account.');
      }
      if (Boolean(user.is_active) === isActive) {
        const account = await trx('users').where({ id: userId })
          .first('id', 'name', 'email', 'role', 'is_active');
        const campuses = await trx('user_campuses as uc').join('campuses as c', 'c.id', 'uc.campus_id')
          .where({ 'uc.user_id': userId, 'uc.is_active': true, 'c.organization_id': organizationId })
          .select('uc.campus_id');
        return {
          id: account.id, name: account.name, email: account.email, role: account.role,
          isActive: Boolean(account.is_active), campusIds: campuses.map((campus) => campus.campus_id)
        };
      }
      await trx('users').where({ id: userId, organization_id: organizationId })
        .update({ is_active: isActive, auth_version: trx.raw('auth_version + 1') });
      if (!isActive) {
        await trx('refresh_tokens').where({ user_id: userId }).whereNull('revoked_at')
          .update({ revoked_at: trx.fn.now() });
        await trx('auth_sessions').where({ user_id: userId }).whereNull('revoked_at')
          .update({ revoked_at: trx.fn.now() });
      }
      await trx('audit_log').insert(auditRow(actor,
        isActive ? 'user.activated' : 'user.deactivated', 'user', userId,
        { isActive: Boolean(user.is_active) }, { isActive }));
      const updated = await trx('users').where({ id: userId })
        .first('id', 'name', 'email', 'role', 'is_active');
      const campuses = await trx('user_campuses as uc').join('campuses as c', 'c.id', 'uc.campus_id')
        .where({ 'uc.user_id': userId, 'uc.is_active': true, 'c.organization_id': organizationId })
        .select('uc.campus_id');
      return {
        id: updated.id, name: updated.name, email: updated.email, role: updated.role,
        isActive: Boolean(updated.is_active), campusIds: campuses.map((campus) => campus.campus_id)
      };
    });
  }
};
