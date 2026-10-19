-- Project Space lists apps through project_resources, while app creation also
-- records the owning project directly on apps.project_id. Older publish paths
-- wrote only that direct column, leaving otherwise valid apps invisible.
INSERT INTO project_resources (
    project_id,
    resource_type,
    resource_id,
    relation,
    added_by
)
SELECT
    a.project_id,
    'app',
    a.id,
    'primary',
    a.created_by
FROM apps a
WHERE a.project_id IS NOT NULL
ON CONFLICT DO NOTHING;
