function createRuntimeState({ now = () => Date.now() } = {}) {
  let draining = false;
  let drainStartedAt = null;

  function snapshot() {
    return {
      draining,
      drain_started_at:
        drainStartedAt === null
          ? null
          : new Date(drainStartedAt).toISOString(),
    };
  }

  return {
    beginDrain() {
      if (!draining) {
        draining = true;
        drainStartedAt = now();
      }
      return snapshot();
    },
    isDraining() {
      return draining;
    },
    snapshot,
  };
}

const runtimeState = createRuntimeState();

module.exports = {
  beginDrain: runtimeState.beginDrain.bind(runtimeState),
  createRuntimeState,
  isDraining: runtimeState.isDraining.bind(runtimeState),
  snapshot: runtimeState.snapshot.bind(runtimeState),
};
