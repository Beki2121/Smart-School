import { spawn } from 'node:child_process';
import { chmod, mkdir, open, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { registerBackgroundJob } from './runtime-status.js';

function artifactPath(directory, databaseName, id) {
  const safeDatabase = databaseName.replace(/[^A-Za-z0-9_-]/g, '_');
  return path.join(directory, `${safeDatabase}-${new Date().toISOString().replace(/[:.]/g, '-')}-${id}.sql`);
}

export async function runDatabaseBackup(repo, config, logger) {
  if (repo.mode !== 'mysql') throw new Error('Scheduled backups require MySQL storage.');
  const directory = path.resolve(config.BACKUP_DIRECTORY);
  let run = null;
  let outputPath = null;
  const backupJob = registerBackgroundJob('database-backup');
  backupJob.start();
  try {
    run = await repo.createBackupRun();
    outputPath = artifactPath(directory, config.DB_NAME, run.id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') await chmod(directory, 0o700);
    const backupFile = await open(outputPath, 'wx', 0o600);
    await backupFile.close();
    await new Promise((resolve, reject) => {
      const args = ['--single-transaction', '--routines', '--triggers', '--host', config.DB_HOST,
        '--port', String(config.DB_PORT), '--user', config.DB_USER, '--result-file', outputPath];
      if (config.DB_SOCKET_PATH) args.push('--socket', config.DB_SOCKET_PATH);
      args.push(config.DB_NAME);
      const child = spawn(config.MYSQLDUMP_PATH, args, {
        shell: false, windowsHide: true,
        env: { ...process.env, MYSQL_PWD: config.DB_PASSWORD }
      });
      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });
      child.once('error', reject);
      child.once('close', (code) => code === 0 ? resolve() :
        reject(Object.assign(new Error('mysqldump failed.'), {
          code: 'MYSQLDUMP_FAILED', exitCode: code, stderr
        })));
    });
    const metadata = await stat(outputPath);
    await repo.finishBackupRun(run.id, {
      status: 'succeeded', sizeBytes: metadata.size, artifactName: path.basename(outputPath)
    });
    backupJob.succeed();
    return { status: 'succeeded', sizeBytes: metadata.size };
  } catch (error) {
    if (run) await repo.finishBackupRun(run.id, {
      status: 'failed', errorCode: error.code ?? 'BACKUP_FAILED'
    });
    if (outputPath) {
      try { await unlink(outputPath); }
      catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') {
          logger.error({ errorCode: cleanupError.code ?? 'BACKUP_CLEANUP_FAILED' },
            'Failed to remove incomplete database backup.');
        }
      }
    }
    backupJob.fail(error.code ?? 'BACKUP_FAILED');
    logger.error({ errorCode: error.code ?? 'BACKUP_FAILED' }, 'Database backup failed');
    throw error;
  }
}

export function startDatabaseBackupWorker(repo, config, logger) {
  if (repo.mode !== 'mysql') return null;
  let running = false;
  const run = () => {
    if (running) {
      logger.warn('Skipping scheduled database backup because a previous run is still active.');
      return;
    }
    running = true;
    void runDatabaseBackup(repo, config, logger)
      .catch(() => {})
      .finally(() => { running = false; });
  };
  run();
  const timer = setInterval(run, config.BACKUP_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
