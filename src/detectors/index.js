import portInUse from './port-in-use.js';
import nodeVersion from './node-version.js';
import moduleNotFound from './module-not-found.js';
import eresolve from './eresolve.js';
import lockfileSync from './lockfile-sync.js';
import eacces from './eacces.js';
import envMissing from './env-missing.js';
import mergeConflict from './merge-conflict.js';

export const DETECTORS = [
  portInUse,
  nodeVersion,
  moduleNotFound,
  eresolve,
  lockfileSync,
  eacces,
  envMissing,
  mergeConflict
];

export default DETECTORS;
