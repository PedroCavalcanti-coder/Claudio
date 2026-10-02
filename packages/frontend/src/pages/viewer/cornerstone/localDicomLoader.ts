import * as cornerstone from '@cornerstonejs/core';
import dicomParser from 'dicom-parser';

declare global {
  interface Window {
    __dicomFiles?: Record<string, File>;
  }
}

export function createDicomFileImageId(file: File, uniqueId: string): string {
  const imageId = `dicomfile:${uniqueId}`;
  window.__dicomFiles = window.__dicomFiles || {};
  window.__dicomFiles[imageId] = file;
  return imageId;
}

type LocalDicomLoaderOptions = { targetBuffer?: { arrayBuffer: ArrayBuffer; offset: number; length: number } };

function dicomfileImageLoader(imageId: string, options?: LocalDicomLoaderOptions) {
  const file = window.__dicomFiles?.[imageId];
  if (!file) {
    throw new Error('Arquivo DICOM não encontrado no cache local');
  }

  const promise = file.arrayBuffer().then((arrayBuffer) => {
    const byteArray = new Uint8Array(arrayBuffer);
    const dataSet = dicomParser.parseDicom(byteArray);

    const rows = dataSet.uint16('x00280010');
    const columns = dataSet.uint16('x00280011');
    const bitsAllocated = dataSet.uint16('x00280100');
    const pixelDataElement = dataSet.elements.x7fe00010;

    if (!rows || !columns || !pixelDataElement) {
      throw new Error('DICOM inválido ou sem pixel data');
    }

    const transferSyntax = dataSet.string('x00020010');
    // só o transfer syntax 1.2.840.10008.1.2.1 (Explicit VR Little Endian, não comprimido) é aceito, pois o parser não decodifica compressão
    const isCompressed = transferSyntax && transferSyntax !== '1.2.840.10008.1.2.1';
    if (isCompressed) {
      throw new Error('DICOM comprimido não suportado. Use arquivos DICOM não comprimidos.');
    }

    const validatedRows = rows as number;
    const validatedColumns = columns as number;
    const pixelCount = validatedRows * validatedColumns;
    let pixelData: Uint8Array | Uint16Array;
    if (bitsAllocated === 16) {
      pixelData = new Uint16Array(arrayBuffer, pixelDataElement.dataOffset, pixelCount);
    } else {
      pixelData = new Uint8Array(arrayBuffer, pixelDataElement.dataOffset, pixelCount);
    }

    const canvas = document.createElement('canvas');

    function getCanvas() {
      canvas.width = validatedColumns;
      canvas.height = validatedRows;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Unable to get canvas context');
      }
      const imageData = ctx.createImageData(validatedColumns, validatedRows);
      const pixelBytes = imageData.data;
      if (pixelData instanceof Uint16Array) {
        for (let i = 0, j = 0; i < pixelData.length; i += 1, j += 4) {
          const value = pixelData[i] & 0xff;
          pixelBytes[j] = value;
          pixelBytes[j + 1] = value;
          pixelBytes[j + 2] = value;
          pixelBytes[j + 3] = 255;
        }
      } else {
        for (let i = 0, j = 0; i < pixelData.length; i += 1, j += 4) {
          const value = pixelData[i];
          pixelBytes[j] = value;
          pixelBytes[j + 1] = value;
          pixelBytes[j + 2] = value;
          pixelBytes[j + 3] = 255;
        }
      }
      ctx.putImageData(imageData, 0, 0);
      return canvas;
    }

    function getPixelData(targetBuffer?: LocalDicomLoaderOptions['targetBuffer']) {
      if (targetBuffer?.arrayBuffer && typeof targetBuffer.offset === 'number' && typeof targetBuffer.length === 'number') {
        const targetArray = new Uint8Array(targetBuffer.arrayBuffer, targetBuffer.offset, targetBuffer.length);
        targetArray.set(new Uint8Array(pixelData.buffer, pixelData.byteOffset, targetArray.length));
        return targetArray;
      }
      return pixelData;
    }

    const image: any = {
      imageId,
      minPixelValue: 0,
      maxPixelValue: 255,
      slope: 1.0,
      intercept: 0,
      windowCenter: 40,
      windowWidth: 400,
      voiLUTFunction: 'LINEAR',
      getPixelData,
      getCanvas,
      rows: validatedRows,
      columns: validatedColumns,
      height: validatedRows,
      width: validatedColumns,
      color: false,
      rgba: false,
      numberOfComponents: 1,
      columnPixelSpacing: 1.0,
      rowPixelSpacing: 1.0,
      invert: false,
      sizeInBytes: pixelData.byteLength,
      dataType: bitsAllocated === 16 ? 'Uint16Array' : 'Uint8Array',
    };

    const wcRaw = dataSet.floatString('x00281050');
    const wwRaw = dataSet.floatString('x00281051');
    const wc = typeof wcRaw === 'string' ? parseFloat(wcRaw) : NaN;
    const ww = typeof wwRaw === 'string' ? parseFloat(wwRaw) : NaN;
    if (!Number.isNaN(wc) && !Number.isNaN(ww)) {
      image.windowCenter = wc;
      image.windowWidth = ww;
    }

    const rescaleSlopeRaw = dataSet.floatString('x00281053');
    const rescaleInterceptRaw = dataSet.floatString('x00281052');
    const rescaleSlope = typeof rescaleSlopeRaw === 'string' ? parseFloat(rescaleSlopeRaw) : NaN;
    const rescaleIntercept = typeof rescaleInterceptRaw === 'string' ? parseFloat(rescaleInterceptRaw) : NaN;
    if (!Number.isNaN(rescaleSlope)) image.slope = rescaleSlope;
    if (!Number.isNaN(rescaleIntercept)) image.intercept = rescaleIntercept;

    const modality = dataSet.string('x00080060');
    if (modality) image.modality = modality;

    if (options?.targetBuffer) {
      image.getPixelData(options.targetBuffer);
    }

    return image;
  });

  return {
    promise,
    cancelFn: undefined,
  };
}

export function registerLocalDicomLoader(): void {
  const { imageLoader } = cornerstone;
  imageLoader.registerImageLoader('dicomfile', dicomfileImageLoader as any);
}
