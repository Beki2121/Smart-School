export function startAssignmentNotificationWorker(repo, logger) {
  if (repo.mode !== 'mysql') return null;

  const processNotifications = async () => {
    try {
      await repo.processAssignmentDueNotifications();
    } catch (error) {
      logger.warn({ errorCode: error.code ?? 'ASSIGNMENT_NOTICE_PROCESSING_FAILED' },
        'Assignment due notification processing failed');
    }
  };
  void processNotifications();
  const timer = setInterval(processNotifications, 15 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
