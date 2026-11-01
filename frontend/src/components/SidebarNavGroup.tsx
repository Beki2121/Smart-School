import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';

export type SidebarNavItem = { label: string; icon: string } & (
  { to: string; disabled?: false; availability?: never } |
  { disabled: true; availability: string; to?: never }
);
export type SidebarNavGroupDefinition = { label: string; icon: string; items: SidebarNavItem[] };

export default function SidebarNavGroup({ group, activePath, onNavigate, defaultOpen = false }: {
  group: SidebarNavGroupDefinition; activePath: string; onNavigate: () => void;
  defaultOpen?: boolean
}) {
  const active = group.items.some((item) => item.to === activePath);
  const [expanded, setExpanded] = useState(active || defaultOpen);
  useEffect(() => { if (active) setExpanded(true); }, [active]);
  return <section className={`nav-group ${active ? 'has-active' : ''}`}>
    <button className="nav-group-toggle" type="button" aria-expanded={expanded}
      onClick={() => setExpanded((value) => !value)}>
      <span className="nav-icon">{group.icon}</span><span>{group.label}</span>
      <span className="nav-chevron" aria-hidden="true">{expanded ? '⌄' : '›'}</span>
    </button>
    {expanded && <div className="nav-group-items">{group.items.map((item) =>
      item.disabled
        ? <span key={item.label} className="nav-item-disabled" aria-disabled="true">
          <span className="nav-icon">{item.icon}</span><span>{item.label}</span>
          <small>{item.availability}</small>
        </span>
        : item.to.startsWith('#')
        ? <a key={item.to} href={item.to} onClick={onNavigate}>
          <span className="nav-icon">{item.icon}</span>{item.label}
        </a>
        : <NavLink key={item.to} to={item.to} end={item.to === '/'}
          onClick={onNavigate}>
          <span className="nav-icon">{item.icon}</span>{item.label}
        </NavLink>
    )}</div>}
  </section>;
}
