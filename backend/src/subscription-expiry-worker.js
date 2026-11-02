export function startSubscriptionExpiryWorker(repo, mailer, logger) {
  if (repo.mode !== 'mysql') return null;

  const processNotifications = async () => {
    try {
      await repo.processSubscriptionExpiryNotifications(mailer, logger);
    } catch (error) {
      logger.warn({ errorCode: error.code ?? 'SUBSCRIPTION_NOTICE_PROCESSING_FAILED' },
        'Subscription expiry notification processing failed');
    }
  };
  void processNotifications();
  const timer = setInterval(processNotifications, 60 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
