import { init as csInit } from '@cornerstonejs/core';
import { init as csToolsInit }         from '@cornerstonejs/tools';
import cornerstoneDICOMImageLoader     from '@cornerstonejs/dicom-image-loader';
import { registerWebImageLoader }      from './webImageLoader';

let initialized = false;

export async function initCornerstoneOnce(): Promise<void> {
  if (initialized) return;
  initialized = true;

  await csInit();

  // registra os prefixos wadouri: e wadors: usados pelo restante do viewer
  cornerstoneDICOMImageLoader.init({
    maxWebWorkers: Math.max(1, Math.floor(navigator.hardwareConcurrency / 2)),
  });

  // registra o prefixo web: para exibir PNG/JPG/TIFF/BMP no mesmo viewer DICOM
  registerWebImageLoader();

  csToolsInit();
}
