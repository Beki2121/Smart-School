import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { now, organizationAdministratorConflict, setupConflict } from '../shared.js';

export const memoryAccountsBundle = {
  async findUserByLogin(login) {
    const user = this.users.find((user) =>
      user.email?.toLowerCase() === login.toLowerCase() ||
      user.username?.toLowerCase() === login.toLowerCase() || user.phone === login) ?? null;
    if (!user) return null;
    const campusIds = (user.campusIds ?? []).filter((campusId) => this.campuses.some((campus) =>
      campus.id === campusId && campus.organizationId === user.orgId && campus.isActive !== false));
    return {
      ...user,
      campusIds,
      activeCampusId: campusIds.includes(user.activeCampusId) ? user.activeCampusId : campusIds[0],
      accountActive: Boolean(user.isActive),
      authVersion: Number(user.authVersion ?? 0),
      isActive: Boolean(user.isActive)
    };
  },
  async findUserById(id) {
    const user = this.users.find((item) => item.id === id);
    if (!user) return null;
    const organization = this.organizations.find((item) => item.id === user.orgId);
    const campusIds = (user.campusIds ?? []).filter((campusId) => this.campuses.some((campus) =>
      campus.id === campusId && campus.organizationId === user.orgId && campus.isActive !== false));
    return {
      ...user,
      campusIds,
      activeCampusId: campusIds.includes(user.activeCampusId) ? user.activeCampusId : campusIds[0],
      accountActive: Boolean(user.isActive),
      authVersion: Number(user.authVersion ?? 0),
      isActive: user.isActive &&
        (user.role === 'super_admin' || !organization || organization.status === 'active')
    };
  },
  async createAccountInvitation(invitation, actor) {
    const existingUser = this.users.find((user) => user.email?.toLowerCase() === invitation.email.toLowerCase());
    if (existingUser) throw setupConflict('An account already uses this email address.');
    const target = this.findInvitationTarget(invitation, actor);
    if (!target) throw setupConflict('The selected person is not eligible for an account invitation.');
    const nowIso = now();
    this.accountInvitations
      .filter((item) => item.targetType === invitation.targetType && item.targetId === invitation.targetId &&
        item.acceptedAt === null)
      .forEach((item) => { item.expiresAt = nowIso; });
    const record = {
      id: invitation.id, orgId: actor.orgId, campusId: actor.activeCampusId,
      email: invitation.email, role: invitation.role, targetType: invitation.targetType,
      targetId: invitation.targetId, targetName: invitation.targetName ?? null,
      tokenHash: invitation.tokenHash,
      expiresAt: invitation.expiresAt, acceptedAt: null, createdBy: actor.sub
    };
    this.accountInvitations.push(record);
    await this.appendAudit(actor, 'account_invitation.created', 'account_invitation', record.id, null, {
      email: record.email, role: record.role, targetType: record.targetType, targetId: record.targetId,
      expiresAt: record.expiresAt
    });
    return { id: record.id, email: record.email, role: record.role, name: target.name, expiresAt: record.expiresAt };
  },
  async regenerateSchoolAdministratorInvitation(organizationId, invitation, actor) {
    const organization = this.organizations.find((item) =>
      item.id === organizationId && item.status === 'active');
    const campus = this.campuses.find((item) =>
      item.organizationId === organizationId && item.isActive !== false);
    if (!organization || !campus || this.users.some((user) =>
      user.orgId === organizationId && user.role === 'owner_director')) return null;
    const previous = [...this.accountInvitations].reverse().find((item) =>
      item.orgId === organizationId && item.targetType === 'school_administrator' &&
      item.targetId === organizationId && item.acceptedAt === null);
    if (!previous || this.users.some((user) =>
      user.email?.toLowerCase() === previous.email.toLowerCase())) return null;
    const nowIso = now();
    const previousExpiries = this.accountInvitations.filter((item) =>
      item.orgId === organizationId && item.targetType === 'school_administrator' &&
      item.targetId === organizationId && item.acceptedAt === null)
      .map((item) => ({ item, expiresAt: item.expiresAt }));
    this.accountInvitations.filter((item) =>
      item.orgId === organizationId && item.targetType === 'school_administrator' &&
      item.targetId === organizationId && item.acceptedAt === null)
      .forEach((item) => { item.expiresAt = nowIso; });
    const record = {
      id: invitation.id, orgId: organizationId, campusId: campus.id,
      email: previous.email, role: 'owner_director', targetType: 'school_administrator',
      targetId: organizationId, targetName: previous.targetName ?? organization.name,
      tokenHash: invitation.tokenHash, expiresAt: invitation.expiresAt,
      acceptedAt: null, createdBy: actor.sub
    };
    this.accountInvitations.push(record);
    try {
      await this.appendAudit(actor, 'account_invitation.regenerated',
        'account_invitation', record.id, null, {
          email: record.email, targetType: record.targetType, targetId: organizationId,
          expiresAt: record.expiresAt
        });
    } catch (error) {
      this.accountInvitations.pop();
      for (const previousRecord of previousExpiries) {
        previousRecord.item.expiresAt = previousRecord.expiresAt;
      }
      throw error;
    }
    return {
      id: record.id, email: record.email, role: record.role,
      name: record.targetName, expiresAt: record.expiresAt
    };
  },
  findInvitationTarget(invitation, actor) {
    if (invitation.targetType === 'platform_administrator') {
      return invitation.orgId === '00000000-0000-4000-8000-000000000001' &&
        invitation.targetId === invitation.orgId && invitation.role === 'super_admin'
        ? { name: invitation.targetName }
        : null;
    }
    if (invitation.targetType === 'school_administrator') {
      const organization = this.organizations.find((item) =>
        item.id === invitation.orgId && item.status === 'active');
      const campus = this.campuses.find((item) =>
        item.id === invitation.campusId && item.organizationId === invitation.orgId &&
        item.isActive !== false);
      return invitation.targetId === invitation.orgId && invitation.role === 'owner_director' &&
        organization && campus
        ? { name: invitation.targetName || organization.name }
        : null;
    }
    if (invitation.targetType === 'staff') {
      const target = this.staff.find((item) => item.id === invitation.targetId &&
        item.campusId === actor.activeCampusId && item.employmentStatus !== 'terminated' &&
        !item.archivedAt && !item.userId);
      return target ? { name: `${target.givenNameEn} ${target.fatherNameEn} ${target.grandfatherNameEn}` } : null;
    }
    if (invitation.targetType === 'student') {
      const target = this.students.find((item) => item.id === invitation.targetId &&
        item.campusId === actor.activeCampusId && item.status === 'enrolled' && !item.archivedAt && !item.userId);
      return target ? { name: `${target.givenNameEn} ${target.fatherNameEn} ${target.grandfatherNameEn}` } : null;
    }
    const target = this.guardians.find((item) => item.id === invitation.targetId &&
      item.orgId === actor.orgId && !item.userId);
    const verifiedLink = this.studentGuardians.some((link) => link.guardianId === invitation.targetId &&
      link.isVerified && this.students.some((student) => student.id === link.studentId &&
        student.campusId === actor.activeCampusId && !student.archivedAt));
    if (invitation.targetType === 'guardian' &&
      (!target?.email || target.email.toLowerCase() !== invitation.email.toLowerCase())) return null;
    return target && verifiedLink
      ? { name: `${target.givenNameEn} ${target.fatherNameEn} ${target.grandfatherNameEn}` }
      : null;
  },
  async getAccountInvitation(tokenHash) {
    const invitation = this.accountInvitations.find((item) => item.tokenHash === tokenHash &&
      !item.acceptedAt && new Date(item.expiresAt) > new Date());
    if (!invitation) return null;
    const target = this.findInvitationTarget(invitation, {
      orgId: invitation.orgId, activeCampusId: invitation.campusId
    });
    return target ? { email: invitation.email, role: invitation.role, name: target.name, expiresAt: invitation.expiresAt } : null;
  },
  async acceptAccountInvitation(tokenHash, passwordHash) {
    const invitation = this.accountInvitations.find((item) => item.tokenHash === tokenHash &&
      !item.acceptedAt && new Date(item.expiresAt) > new Date());
    if (!invitation) return null;
    if (this.users.some((user) => user.email?.toLowerCase() === invitation.email.toLowerCase())) {
      throw setupConflict('An account already uses this email address.');
    }
    const actor = { orgId: invitation.orgId, activeCampusId: invitation.campusId };
    const target = this.findInvitationTarget(invitation, actor);
    if (!target) return null;
    const userId = randomUUID();
    const campusIds = invitation.targetType === 'platform_administrator'
      ? []
      : invitation.targetType === 'school_administrator'
      ? this.campuses.filter((campus) =>
        campus.organizationId === invitation.orgId && campus.isActive !== false)
        .map((campus) => campus.id)
      : invitation.targetType === 'guardian'
      ? [...new Set(this.studentGuardians.filter((link) =>
        link.guardianId === invitation.targetId && link.isVerified)
        .map((link) => this.students.find((student) => student.id === link.studentId)?.campusId)
        .filter((campusId) => campusId && (campusId === invitation.campusId ||
          this.campuses.some((campus) => campus.id === campusId && campus.organizationId === invitation.orgId))))]
      : [invitation.campusId];
    const user = {
      id: userId, orgId: invitation.orgId, name: target.name, email: invitation.email,
      phone: null, passwordHash, role: invitation.role, campusIds,
      activeCampusId: invitation.targetType === 'platform_administrator' ? null : invitation.campusId,
      isActive: true
    };
    this.users.push(user);
    if (invitation.targetType === 'platform_administrator') {
      // Platform users do not belong to a school campus.
    } else if (invitation.targetType === 'school_administrator') {
      if (!campusIds.includes(invitation.campusId)) { this.users.pop(); return null; }
    } else if (invitation.targetType === 'staff') {
      const staff = this.staff.find((item) => item.id === invitation.targetId);
      if (!staff || staff.userId) { this.users.pop(); return null; }
      staff.userId = userId;
    } else if (invitation.targetType === 'student') {
      const student = this.students.find((item) => item.id === invitation.targetId);
      if (!student || student.userId) { this.users.pop(); return null; }
      student.userId = userId;
    } else if (invitation.targetType === 'guardian') {
      const guardian = this.guardians.find((item) => item.id === invitation.targetId);
      if (!guardian || guardian.userId) { this.users.pop(); return null; }
      guardian.userId = userId;
    }
    invitation.acceptedAt = now();
    try {
      await this.appendAudit({ sub: userId, orgId: invitation.orgId, activeCampusId: invitation.campusId },
        'account_invitation.accepted', 'user', userId, null, {
          email: invitation.email, role: invitation.role, targetType: invitation.targetType, targetId: invitation.targetId
        });
    } catch (error) {
      if (invitation.targetType === 'school_administrator' ||
          invitation.targetType === 'platform_administrator') {
        this.users.pop();
        invitation.acceptedAt = null;
      }
      throw error;
    }
    return user;
  },
  async recordLoginFailure(login) {
    const item = this.loginFailures.get(login) ?? { count: 0, since: Date.now() };
    if (Date.now() - item.since > 15 * 60_000) {
      item.count = 0;
      item.since = Date.now();
    }
    item.count += 1;
    this.loginFailures.set(login, item);
    return item.count;
  },
  async clearLoginFailures(login) { this.loginFailures.delete(login); },
  async changePassword(userId, currentPassword, newPassword, actor) {
    const user = this.users.find((item) => item.id === userId);
    if (!user || !await bcrypt.compare(currentPassword, user.passwordHash)) return null;
    if (await bcrypt.compare(newPassword, user.passwordHash)) {
      throw setupConflict('Choose a password different from your temporary password.');
    }
    user.passwordHash = await bcrypt.hash(newPassword, 12);
    user.mustChangePassword = false;
    user.authVersion = Number(user.authVersion ?? 0) + 1;
    for (const [tokenHash, token] of this.refreshTokens) {
      if (token.userId === userId) this.refreshTokens.delete(tokenHash);
    }
    for (const session of this.authSessions.values()) {
      if (session.userId === userId) session.revokedAt = now();
    }
    await this.appendAudit(actor, 'user.password_changed', 'user', userId, null, null);
    return user;
  },
  async createPasswordReset(email, tokenHash, expiresAt) {
    const user = this.users.find((item) =>
      item.email?.toLowerCase() === email.toLowerCase() && item.isActive);
    if (!user) return null;
    for (const [hash, reset] of this.passwordResetTokens) {
      if (reset.userId === user.id) this.passwordResetTokens.delete(hash);
    }
    this.passwordResetTokens.set(tokenHash, { userId: user.id, expiresAt });
    await this.appendAudit({
      sub: user.id, orgId: user.orgId, activeCampusId: user.activeCampusId ?? null
    }, 'auth.password_reset_requested', 'user', user.id, null, null);
    return { userId: user.id, name: user.name, email: user.email };
  },
  async revokePasswordResetToken(tokenHash) {
    this.passwordResetTokens.delete(tokenHash);
  },
  async completePasswordReset(tokenHash, passwordHash) {
    const reset = this.passwordResetTokens.get(tokenHash);
    if (!reset || new Date(reset.expiresAt) <= new Date()) return null;
    const user = this.users.find((item) => item.id === reset.userId && item.isActive);
    this.passwordResetTokens.delete(tokenHash);
    if (!user) return null;
    user.passwordHash = passwordHash;
    user.mustChangePassword = false;
    user.authVersion = Number(user.authVersion ?? 0) + 1;
    for (const [hash, item] of this.passwordResetTokens) {
      if (item.userId === user.id) this.passwordResetTokens.delete(hash);
    }
    for (const [hash, item] of this.refreshTokens) {
      if (item.userId === user.id) this.refreshTokens.delete(hash);
    }
    for (const session of this.authSessions.values()) {
      if (session.userId === user.id) session.revokedAt = now();
    }
    await this.appendAudit({
      sub: user.id, orgId: user.orgId, activeCampusId: user.activeCampusId ?? null
    }, 'auth.password_reset_completed', 'user', user.id, null, null);
    return user;
  },
  async storeRefreshToken(tokenHash, userId, expiresAt, campusId = null, sessionId, metadata = {}) {
    const id = sessionId ?? randomUUID();
    const session = this.authSessions.get(id);
    if (session?.revokedAt) {
      const error = new Error('This session is no longer valid. Sign in again.');
      error.status = 401;
      error.code = 'SESSION_REVOKED';
      throw error;
    }
    const user = this.users.find((item) => item.id === userId);
    const timestamp = now();
    this.authSessions.set(id, {
      id, userId, organizationId: user?.orgId ?? null, campusId,
      ipAddress: session?.ipAddress ?? metadata.ipAddress ?? null,
      userAgent: session?.userAgent ?? metadata.userAgent ?? null,
      createdAt: session?.createdAt ?? timestamp, lastSeenAt: timestamp,
      expiresAt, revokedAt: null
    });
    this.refreshTokens.set(tokenHash, { userId, expiresAt, campusId, sessionId: id });
  },
  async consumeRefreshToken(tokenHash) {
    const row = this.refreshTokens.get(tokenHash);
    if (!row || new Date(row.expiresAt) <= new Date()) return null;
    this.refreshTokens.delete(tokenHash);
    const user = await this.findUserById(row.userId);
    if (!user) return null;
    return {
      ...user, activeCampusId: row.campusId ?? user.activeCampusId,
      branchActive: !row.campusId || user.campusIds.includes(row.campusId),
      sessionId: row.sessionId,
      sessionMetadata: {
        ipAddress: this.authSessions.get(row.sessionId)?.ipAddress ?? null,
        userAgent: this.authSessions.get(row.sessionId)?.userAgent ?? null
      }
    };
  },
  async switchRefreshTokenCampus(tokenHash, userId, campusId, nextTokenHash, expiresAt, actor, sessionId) {
    const row = this.refreshTokens.get(tokenHash);
    if (!row || row.userId !== userId || new Date(row.expiresAt) <= new Date()) return null;
    const user = await this.findUserById(userId);
    if (!user || !user.campusIds.includes(campusId)) return null;
    const campus = this.campuses.find((item) =>
      item.id === campusId && item.organizationId === user.orgId && item.isActive !== false);
    if (!campus) return null;
    const activeSessionId = row.sessionId ?? sessionId ?? randomUUID();
    const existingSession = this.authSessions.get(activeSessionId);
    if (existingSession?.revokedAt) return null;
    const previousSession = existingSession ? { ...existingSession } : null;
    const timestamp = now();
    this.refreshTokens.delete(tokenHash);
    this.refreshTokens.set(nextTokenHash, { userId, expiresAt, campusId, sessionId: activeSessionId });
    this.authSessions.set(activeSessionId, {
      id: activeSessionId, userId, organizationId: user.orgId, campusId,
      ipAddress: existingSession?.ipAddress ?? null,
      userAgent: existingSession?.userAgent ?? null,
      createdAt: existingSession?.createdAt ?? timestamp,
      lastSeenAt: timestamp, expiresAt, revokedAt: null
    });
    try {
      await this.appendAudit({ ...actor, activeCampusId: campusId },
        'auth.branch_switched', 'campus', campusId,
        { activeCampusId: actor.activeCampusId }, { activeCampusId: campusId });
    } catch (error) {
      this.refreshTokens.delete(nextTokenHash);
      this.refreshTokens.set(tokenHash, row);
      if (previousSession) this.authSessions.set(activeSessionId, previousSession);
      else this.authSessions.delete(activeSessionId);
      throw error;
    }
    return { ...user, activeCampusId: campusId, sessionId: activeSessionId };
  },
  async revokeRefreshToken(tokenHash) {
    const token = this.refreshTokens.get(tokenHash);
    this.refreshTokens.delete(tokenHash);
    if (token?.sessionId && this.authSessions.has(token.sessionId)) {
      this.authSessions.get(token.sessionId).revokedAt = now();
    }
    return token ? this.findUserById(token.userId) : null;
  },
  async listOrganizationAccounts(organizationId) {
    return this.users.filter((user) => user.orgId === organizationId && user.role !== 'super_admin').map((user) => ({
      id: user.id, name: user.name, email: user.email, role: user.role,
      isActive: Boolean(user.isActive), campusIds: [...(user.campusIds ?? [])]
    })).sort((left, right) => left.name.localeCompare(right.name));
  },
  async setOrganizationAccountStatus(organizationId, userId, isActive, actor) {
    const user = this.users.find((item) =>
      item.id === userId && item.orgId === organizationId && item.role !== 'super_admin');
    if (!user) return null;
    if (user.role === 'owner_director' && user.isActive && !isActive &&
        this.users.filter((item) => item.orgId === organizationId &&
          item.role === 'owner_director' && item.isActive).length <= 1) {
      throw organizationAdministratorConflict();
    }
    if (userId === actor.sub && !isActive) {
      throw setupConflict('You cannot deactivate your own account.');
    }
    if (Boolean(user.isActive) === isActive) {
      return {
        id: user.id, name: user.name, email: user.email, role: user.role,
        isActive: Boolean(user.isActive), campusIds: [...(user.campusIds ?? [])]
      };
    }
    const previousIsActive = Boolean(user.isActive);
    user.isActive = isActive;
    user.authVersion = Number(user.authVersion ?? 0) + 1;
    if (!isActive) {
      for (const [hash, token] of this.refreshTokens) {
        if (token.userId === userId) this.refreshTokens.delete(hash);
      }
      for (const session of this.authSessions.values()) {
        if (session.userId === userId) session.revokedAt = now();
      }
    }
    await this.appendAudit(actor, isActive ? 'user.activated' : 'user.deactivated',
      'user', userId, { isActive: previousIsActive }, { isActive });
    return {
      id: user.id, name: user.name, email: user.email, role: user.role,
      isActive: Boolean(user.isActive), campusIds: [...(user.campusIds ?? [])]
    };
  }
};
