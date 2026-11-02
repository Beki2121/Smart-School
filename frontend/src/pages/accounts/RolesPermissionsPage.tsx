import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { api, ManagedRole, PermissionDefinition } from '../../api';

type T = (key: string) => string;

export default function RolesPermissionsPage({ t }: { t: T }) {
  const [roles, setRoles] = useState<ManagedRole[]>([]);
  const [permissions, setPermissions] = useState<PermissionDefinition[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [newRoleName, setNewRoleName] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const catalog = await api.roles();
      setRoles(catalog.roles);
      setPermissions(catalog.permissions);
      setSelectedKey((current) => current || catalog.roles.find((role) => !role.isSystem)?.key ||
        catalog.roles[0]?.key || '');
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('apiError'));
    } finally { setLoading(false); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  const selectedRole = roles.find((role) => role.key === selectedKey) ?? null;
  useEffect(() => {
    setSelectedPermissions(selectedRole?.permissions ?? []);
  }, [selectedKey, roles]);

  const modules = useMemo(() => {
    const grouped = new Map<string, PermissionDefinition[]>();
    for (const permission of permissions) {
      const module = permission.key.split('.')[0];
      const items = grouped.get(module) ?? [];
      items.push(permission);
      grouped.set(module, items);
    }
    return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [permissions]);

  const togglePermission = (key: string) => {
    setSelectedPermissions((current) => current.includes(key)
      ? current.filter((permission) => permission !== key)
      : [...current, key]);
  };

  const createRole = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      const role = await api.createRole(newRoleName, selectedPermissions);
      setRoles((current) => [...current, role].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedKey(role.key);
      setNewRoleName('');
      setNotice(t('roleCreated'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('apiError'));
    } finally { setBusy(false); }
  };

  const savePermissions = async () => {
    if (!selectedRole || selectedRole.isSystem) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const role = await api.updateRolePermissions(selectedRole.key, selectedPermissions);
      setRoles((current) => current.map((item) => item.key === role.key ? role : item));
      setNotice(t('rolePermissionsSaved'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('apiError'));
    } finally { setBusy(false); }
  };

  if (loading) return <div className="loading-state">{t('loading')}</div>;
  return <section className="page-section">
    <header className="section-heading"><div>
      <span className="eyebrow">{t('accounts')}</span>
      <h1>{t('rolesPermissions')}</h1>
      <p className="muted">{t('rolePermissionsHint')}</p>
    </div><button className="button button-quiet" onClick={() => void load()}>{t('refresh')}</button></header>
    {error && <div className="form-error" role="alert">{error}</div>}
    {notice && <div className="notice notice-success" role="status">{notice}</div>}
    <section className="panel">
      <label>{t('selectRole')}<select value={selectedKey}
        onChange={(event) => setSelectedKey(event.target.value)}>
        {roles.map((role) => <option key={role.id} value={role.key}>
          {role.name}{role.isSystem ? ` · ${t('systemRole')}` : ''}
        </option>)}
      </select></label>
      {selectedRole?.isSystem && <p className="muted">{t('systemRoleReadOnly')}</p>}
      <div className="table-wrap">
        <table className="role-permission-table">
          <thead><tr><th>{t('permissionModule')}</th><th>{t('permission')}</th>
            <th>{t('allowed')}</th></tr></thead>
          <tbody>{modules.flatMap(([module, items]) => items.map((permission, index) =>
            <tr key={permission.key}>
              {index === 0 && <th scope="rowgroup" rowSpan={items.length}>{module}</th>}
              <td>{permission.key}</td>
              <td><input type="checkbox" aria-label={`${permission.key} ${t('allowed')}`}
                checked={selectedPermissions.includes(permission.key)}
                disabled={!selectedRole || selectedRole.isSystem || busy}
                onChange={() => togglePermission(permission.key)} /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {selectedRole && !selectedRole.isSystem && <button className="button button-primary"
        disabled={busy} onClick={() => void savePermissions()}>{t('savePermissions')}</button>}
    </section>
    <form className="panel settings-form" onSubmit={(event) => void createRole(event)}>
      <div className="panel-heading"><div><h2>{t('createCustomRole')}</h2>
        <p>{t('customRolePermissionsHint')}</p></div></div>
      <label>{t('roleName')}<input value={newRoleName}
        onChange={(event) => setNewRoleName(event.target.value)} minLength={2} maxLength={120} required /></label>
      <button className="button button-primary" disabled={busy}>{t('createRole')}</button>
    </form>
  </section>;
}
