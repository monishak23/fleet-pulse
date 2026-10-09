export const DEFAULT_CHAOS = { rate: 500 };
let chaos = { ...DEFAULT_CHAOS };

export const getChaos = () => chaos;
export const mergeChaos = (patch) => (chaos = { ...chaos, ...patch });
export const resetChaos = () => (chaos = { ...DEFAULT_CHAOS });