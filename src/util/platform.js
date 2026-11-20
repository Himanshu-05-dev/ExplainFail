export const isWindows = () => process.platform === 'win32';
export const isMacOS = () => process.platform === 'darwin';
export const isLinux = () => process.platform === 'linux';
export const isPosix = () => process.platform !== 'win32';
