import {describe,it,expect,vi} from 'vitest';
import {recoverChunkLoadError} from './chunk-error-recovery';
describe('manual lazy-module recovery',()=>{
  it.each(['Failed to fetch dynamically imported module: /AppDetail.tsx','Importing a module script failed','Loading chunk 123 failed','ChunkLoadError'])('reloads a rejected module: %s',message=>{
    const reload=vi.fn();expect(recoverChunkLoadError(new TypeError(message),reload)).toBe(true);expect(reload).toHaveBeenCalledTimes(1);
  });
  it('retains normal boundary reset for component errors',()=>{const reload=vi.fn();expect(recoverChunkLoadError(new Error('Invalid props'),reload)).toBe(false);expect(reload).not.toHaveBeenCalled();});
});
