export const setupStages = ['welcome', 'profile', 'model', 'access', 'memory', 'review'];
export const initialSetup = {
  version: 1,
  stage: 'welcome',
  status: 'not-started',
  outcomes: {},
  lessons: {},
};
export function validateSetup(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.version !== 1 ||
    !setupStages.includes(value.stage) ||
    !['not-started', 'in-progress', 'deferred', 'completed'].includes(value.status)
  )
    throw Error('Invalid setup progress');
  if (
    Object.keys(value).some(
      (k) => !['version', 'stage', 'status', 'outcomes', 'lessons'].includes(k),
    )
  )
    throw Error('Setup progress cannot contain personal data or credentials');
  const outcomes = value.outcomes ?? {},
    lessons = value.lessons ?? {};
  if (
    typeof outcomes !== 'object' ||
    Array.isArray(outcomes) ||
    typeof lessons !== 'object' ||
    Array.isArray(lessons)
  )
    throw Error('Invalid setup progress maps');
  if (
    Object.keys(outcomes).length > 6 ||
    Object.entries(outcomes).some(
      ([k, v]) => !setupStages.includes(k) || !['configured', 'skipped'].includes(v),
    )
  )
    throw Error('Invalid setup stage outcome');
  if (
    Object.keys(lessons).length > 20 ||
    Object.entries(lessons).some(
      ([k, v]) => !/^[a-z-]{1,40}$/.test(k) || !Number.isInteger(v) || v < 0 || v > 20,
    )
  )
    throw Error('Invalid lesson progress');
  return {
    version: 1,
    stage: value.stage,
    status: value.status,
    outcomes: { ...outcomes },
    lessons: { ...lessons },
  };
}
