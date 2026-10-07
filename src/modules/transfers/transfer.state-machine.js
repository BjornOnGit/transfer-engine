const TRANSITIONS = {
  initiated: ['rate_locked', 'failed'],
  rate_locked: ['funds_moved', 'failed'],
  funds_moved: ['completed', 'reversed'],
  completed: ['reversed'],
  failed: [],
  reversed: [],
};

const canTransition = (from, to) =>
  Object.prototype.hasOwnProperty.call(TRANSITIONS, from) && TRANSITIONS[from].includes(to);

module.exports = { TRANSITIONS, canTransition };