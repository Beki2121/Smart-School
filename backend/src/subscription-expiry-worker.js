import { registerBackgroundJob } from './runtime-status.js';

export function startSubscriptionExpiryWorker(repo, mailer, logger) {
  if (repo.mode !== 'mysql') return null;
  const job = registerBackgroundJob('subscription-expiry-notifications');

  const processNotifications = async () => {
    job.start();
    try {
      await repo.processSubscriptionExpiryNotifications(mailer, logger);
      job.succeed();
    } catch (error) {
      job.fail(error.code ?? 'SUBSCRIPTION_NOTICE_PROCESSING_FAILED');
      logger.warn({ errorCode: error.code ?? 'SUBSCRIPTION_NOTICE_PROCESSING_FAILED' },
        'Subscription expiry notification processing failed');
    }
  };
  void processNotifications();
  const timer = setInterval(processNotifications, 60 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
