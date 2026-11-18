// Devuelve un statement preparado para incluirlo en un db.batch() junto al cambio auditado.
export function auditStmt(ctx, action, entity = null, entityId = null, details = null) {
  return ctx.env.DB.prepare(
    'INSERT INTO audit_log (user_id, username, action, entity, entity_id, details, ip) VALUES (?,?,?,?,?,?,?)'
  ).bind(
    ctx.user?.id ?? null,
    ctx.user?.username ?? null,
    action,
    entity,
    entityId,
    details ? JSON.stringify(details).slice(0, 4000) : null,
    ctx.ip
  );
}

export function audit(ctx, ...args) {
  return auditStmt(ctx, ...args).run();
}
