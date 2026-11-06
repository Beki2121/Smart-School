import { registerBackgroundJob } from './runtime-status.js';

export function startAssignmentNotificationWorker(repo, logger) {
  if (repo.mode !== 'mysql') return null;
  const job = registerBackgroundJob('assignment-due-notifications');

  const processNotifications = async () => {
    job.start();
    try {
      await repo.processAssignmentDueNotifications();
      job.succeed();
    } catch (error) {
      job.fail(error.code ?? 'ASSIGNMENT_NOTICE_PROCESSING_FAILED');
      logger.warn({ errorCode: error.code ?? 'ASSIGNMENT_NOTICE_PROCESSING_FAILED' },
        'Assignment due notification processing failed');
    }
  };
  void processNotifications();
  const timer = setInterval(processNotifications, 15 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
