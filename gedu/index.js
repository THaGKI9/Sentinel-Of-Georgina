const { CronJob } = require('cron');
const logger = require('log4js').getLogger('main');
const utils = require('./utils');
const Report = require('./report');
const Bridge = require('./bridge');
const config = require('./config');


const api = new Bridge(config.server.url, config.logLevel);
const reporter = new Report(config);

/**
 * @return {boolean}
 */
const login = async function login() {
  logger.info('start to login');
  const loginResult = await api.login(config.server.username, config.server.password);
  logger.info(`login result: ${loginResult.success}. message: ${loginResult.message}.`);
  return loginResult.success;
};

/**
 * Wrap the `onTick` function in `CronJob` options.
 * This wrapper redirect promise rejection to logger.
 *
 * @param {Promise<void>} func
 * @return {Promise<void>}
 */
const onTickWrapper = function onTickWrapper(func) {
  return function onTick() { func(this).catch(err => logger.error(err)); };
};

async function main() {
  logger.level = config.logLevel;
  logger.info('Sentinel of Georgina starts. :)');

  let events = [];
  let needLogin = true;
  const jobs = [];
  const timeZone = 'Asia/Shanghai';

  const stopAllJobs = () => jobs.forEach(job => job.stop());

  const jobUpdateEvents = new CronJob({
    cronTime: '* */30 * * * *',
    onTick: onTickWrapper(async () => {
      if (needLogin) {
        logger.info('login is needed. jobUpdateEvents is pending.');
        return;
      }

      logger.debug('start to get events.');
      const result = await api.getEvents(new Date());
      if (!result.success) {
        logger.info('fail to get events.');

        if (result.needLogin) {
          logger.info('login session seems expired. tell login jobs to start to login.');
          needLogin = true;
          return;
        }

        logger.error('reason of failure to get events is unknown. process is about to stop.');
        stopAllJobs();
      }

      const newEvents = result.events.sort((a, b) => a.start - b.start);
      const totalHours = utils.calcHours(newEvents);
      logger.info(`events: ${newEvents.length}. total hours: ${totalHours}`);

      const oldEvents = events;
      events = newEvents;

      setImmediate(onTickWrapper(async () => {
        const oldE = utils.getRecentEvents(oldEvents, config.monitor.dayRange);
        const newE = utils.getRecentEvents(newEvents, config.monitor.dayRange);

        const compareResult = utils.compareEvents(oldE, newE);
        logger.debug(`compare result: ${JSON.stringify(compareResult)}`);
        if (!compareResult) {
          logger.info('no event changes');
          return;
        }

        await reporter.sendWeeklyReport(oldE, newE, config.monitor.dayRange);
      }));
    }),
    start: false,
    timeZone,
  });

  const jobLogin = new CronJob({
    cronTime: '* * * * * *',
    onTick: onTickWrapper(async (ctx) => {
      if (!needLogin) return;
      ctx.stop();
      if (!await login()) stopAllJobs();
      else {
        needLogin = false;

        if (!ctx.LOGIN_INITIALIZED) {
          jobUpdateEvents.fireOnTick();
          jobUpdateEvents.start();
          ctx.LOGIN_INITIALIZED = true;
        }
      }
      ctx.start();
    }),
    start: false,
    timeZone,
  });

  jobs.push(jobUpdateEvents, jobLogin);

  jobLogin.start();
}

main().catch(err => logger.error(err));
