const moment = require('moment');

module.exports = {
  /**
   *
   * @param {{start: Date, end: Date}[]} e
   * @return {number}
   */
  calcHours(e) {
    return e.reduce((prev, curr) => prev + (curr.end - curr.start), 0) / (1000 * 60 * 60);
  },

  /**
   *
   * @param {{name: string, start: Date, end: Date}[]} prev
   * @param {{name: string, start: Date, end: Date}[]} curr
   * @return {{prevHours: number, currHours: number}}
   */
  compareEvents(prev, curr) {
    const result = {
      prevHours: this.calcHours(prev),
      currHours: this.calcHours(curr),
    };

    if (result.prevHours !== result.currHours || prev.length !== curr.length) return result;

    for (let index = 0; index < prev.length; index += 1) {
      const same = +prev[index].start === +curr[index].start
        && +prev[index].end === +curr[index].end
        && prev[index].name === curr[index].name;

      if (!same) return result;
    }

    return null;
  },

  /**
   * @param {{name: string, start: Date, end: Date}[]} events
   * @param {number} dayRange
   * @return {{name: string, start: Date, end: Date}[]}
   */
  getRecentEvents(events, dayRange) {
    const now = moment();
    return events.filter((event) => {
      const dayDiff = moment(event.start).diff(now, 'days');
      return dayDiff > 0 && dayDiff <= dayRange;
    });
  },
};
