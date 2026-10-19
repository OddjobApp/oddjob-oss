INSERT INTO project_members (project_id, principal_type, principal_id, role, added_by)
SELECT p.id, 'user', ar.user_id, 'owner', ar.user_id
FROM admin_roles ar
JOIN orgs o ON o.name = 'Oddjob System'
JOIN projects p ON p.organization_id = o.org_id AND p.is_default = true
WHERE ar.role = 'super_admin'
ON CONFLICT (project_id, principal_type, principal_id) DO NOTHING;

INSERT INTO project_finance_roles (project_id, organization_id, user_id, role, granted_by)
SELECT p.id, o.org_id, ar.user_id, 'executive', ar.user_id
FROM admin_roles ar
JOIN orgs o ON o.name = 'Oddjob System'
JOIN projects p ON p.organization_id = o.org_id AND p.is_default = true
WHERE ar.role = 'super_admin'
ON CONFLICT (project_id, user_id, role) DO NOTHING;
