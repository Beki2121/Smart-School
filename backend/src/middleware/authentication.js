import { verifyAccessToken } from '../auth.js';

export function authenticate(config, repo) {
  return async (request, response, next) => {
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return response.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Sign in to continue.' } });
    let claims;
    try {
      claims = verifyAccessToken(token, config);
    } catch {
      return response.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Access token expired or invalid.' } });
    }
    if (!claims.sub || (!claims.orgId &&
        !['super_admin', 'support_staff'].includes(claims.role))) {
      return response.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Invalid access token.' } });
    }
    try {
      const currentUser = await repo.findUserById(claims.sub);
      if (claims.sessionId && !await repo.isSessionActive(claims.sessionId, claims.sub)) {
        return response.status(401).json({
          error: { code: 'SESSION_REVOKED', message: 'This session is no longer valid. Sign in again.' }
        });
      }
      if (currentUser?.accountActive === false) {
        return response.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Your account is inactive. Contact your school administrator.' } });
      }
      if (currentUser && claims.authVersion !== undefined &&
          Number(claims.authVersion) !== Number(currentUser.authVersion ?? 0)) {
        return response.status(401).json({ error: { code: 'SESSION_REVOKED', message: 'This session is no longer valid. Sign in again.' } });
      }
      if (!currentUser) {
        request.user = claims;
      } else {
        const isPlatformRole = ['super_admin', 'support_staff'].includes(currentUser.role);
        if (!isPlatformRole &&
            (!claims.activeCampusId || !currentUser.campusIds.includes(claims.activeCampusId))) {
          return response.status(401).json({
            error: { code: 'SESSION_CAMPUS_UNAVAILABLE', message: 'This session branch is no longer active. Sign in again or choose another branch.' }
          });
        }
        const activeCampusId = isPlatformRole ? null : claims.activeCampusId;
        if (!isPlatformRole &&
            (!activeCampusId || !currentUser.campusIds.includes(activeCampusId))) {
          return response.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Invalid access token.' } });
        }
        request.user = {
          ...claims, orgId: currentUser.orgId, role: currentUser.role,
          name: currentUser.name, email: currentUser.email,
          campusIds: currentUser.campusIds, activeCampusId
        };
      }
    } catch (error) { return next(error); }
    if (['super_admin', 'support_staff'].includes(request.user.role)) return next();
    if (!['super_admin', 'support_staff'].includes(request.user.role)) {
      try {
        if (!await repo.isOrganizationOperational(request.user.orgId)) {
          return response.status(403).json({
            error: { code: 'SCHOOL_INACTIVE', message: 'School access is suspended or closed. Contact the platform team.' }
          });
        }
      } catch (error) { return next(error); }
    }
    next();
  };
}
