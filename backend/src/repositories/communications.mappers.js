export function mapCampusAnnouncement(row) {
  const publishedAt = row.published_at ?? row.publishedAt;
  return {
    id: row.id, campusId: row.campus_id ?? row.campusId,
    titleEn: row.title_en ?? row.titleEn, titleAm: row.title_am ?? row.titleAm,
    bodyEn: row.body_en ?? row.bodyEn, bodyAm: row.body_am ?? row.bodyAm,
    createdBy: row.created_by ?? row.createdBy,
    publishedAt: publishedAt instanceof Date ? publishedAt.toISOString() : publishedAt
  };
}

export function mapCampusEvent(row) {
  return {
    id: row.id, campusId: row.campus_id ?? row.campusId,
    titleEn: row.title_en ?? row.titleEn, titleAm: row.title_am ?? row.titleAm,
    descriptionEn: row.description_en ?? row.descriptionEn,
    descriptionAm: row.description_am ?? row.descriptionAm,
    startsOn: String(row.starts_on ?? row.startsOn).slice(0, 10),
    endsOn: String(row.ends_on ?? row.endsOn).slice(0, 10),
    startsAt: (row.starts_at ?? row.startsAt) == null ? null : String(row.starts_at ?? row.startsAt).slice(0, 5),
    endsAt: (row.ends_at ?? row.endsAt) == null ? null : String(row.ends_at ?? row.endsAt).slice(0, 5),
    location: row.location ?? '',
    createdBy: row.created_by ?? row.createdBy
  };
}

export function mapUserNotification(row) {
  const createdAt = row.created_at ?? row.createdAt;
  const readAt = row.read_at ?? row.readAt ?? null;
  return {
    id: row.id,
    campusId: row.campus_id !== undefined ? row.campus_id : row.campusId ?? null,
    organizationId: row.organization_id ?? row.organizationId ?? null,
    sourceType: row.source_type ?? row.sourceType,
    sourceId: row.source_id ?? row.sourceId,
    titleEn: row.title_en ?? row.titleEn, titleAm: row.title_am ?? row.titleAm,
    bodyEn: row.body_en ?? row.bodyEn, bodyAm: row.body_am ?? row.bodyAm,
    readAt: readAt instanceof Date ? readAt.toISOString() : readAt,
    createdAt: createdAt instanceof Date ? createdAt.toISOString() : createdAt
  };
}
