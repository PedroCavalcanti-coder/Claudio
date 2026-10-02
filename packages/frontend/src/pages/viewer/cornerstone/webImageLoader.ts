import { registerImageLoader } from '@cornerstonejs/core';

type TargetBuffer = {
  arrayBuffer: ArrayBuffer;
  offset: number;
  length: number;
};

type WebLoaderOptions = {
  targetBuffer?: TargetBuffer;
};

const canvas = document.createElement('canvas');
let lastImageIdDrawn = '';

function createImage(image: HTMLImageElement, imageId: string) {
  const rows = image.naturalHeight;
  const columns = image.naturalWidth;

  function getImageData() {
    if (lastImageIdDrawn !== imageId) {
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Unable to get canvas context');
      ctx.drawImage(image, 0, 0);
      lastImageIdDrawn = imageId;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Unable to get canvas context');
    return ctx.getImageData(0, 0, image.naturalWidth, image.naturalHeight);
  }

  function convertImageDataToRGB(imageData: ImageData, targetArray: Uint8Array) {
    for (let i = 0, j = 0; i < imageData.data.length; i += 4, j += 3) {
      targetArray[j] = imageData.data[i];
      targetArray[j + 1] = imageData.data[i + 1];
      targetArray[j + 2] = imageData.data[i + 2];
    }
  }

  function getPixelData(targetBuffer?: TargetBuffer) {
    const imageData = getImageData();
    let targetArray: Uint8Array;

    if (targetBuffer?.arrayBuffer && typeof targetBuffer.offset === 'number' && typeof targetBuffer.length === 'number') {
      targetArray = new Uint8Array(targetBuffer.arrayBuffer, targetBuffer.offset, targetBuffer.length);
      convertImageDataToRGB(imageData, targetArray);
      return targetArray;
    }

    targetArray = new Uint8Array(imageData.width * imageData.height * 3);
    convertImageDataToRGB(imageData, targetArray);
    return targetArray;
  }

  function getCanvas() {
    if (lastImageIdDrawn !== imageId) {
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Unable to get canvas context');
      ctx.drawImage(image, 0, 0);
      lastImageIdDrawn = imageId;
    }

    return canvas;
  }

  return {
    imageId,
    minPixelValue: 0,
    maxPixelValue: 255,
    slope: 1,
    intercept: 0,
    windowCenter: 128,
    windowWidth: 255,
    getPixelData,
    getCanvas,
    getImage: () => image,
    rows,
    columns,
    height: rows,
    width: columns,
    color: true,
    rgba: false,
    columnPixelSpacing: 1,
    rowPixelSpacing: 1,
    invert: false,
    sizeInBytes: rows * columns * 3,
    numberOfComponents: 3,
  } as const;
}

function arrayBufferToImage(arrayBuffer: ArrayBuffer) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const arrayBufferView = new Uint8Array(arrayBuffer);
    const blob = new Blob([arrayBufferView]);
    const urlCreator = window.URL || window.webkitURL;
    const imageUrl = urlCreator.createObjectURL(blob);

    image.onload = () => {
      resolve(image);
      urlCreator.revokeObjectURL(imageUrl);
    };

    image.onerror = (error) => {
      urlCreator.revokeObjectURL(imageUrl);
      reject(error);
    };

    image.src = imageUrl;
  });
}

function loadImage(uri: string, imageId: string) {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', uri, true);
  xhr.responseType = 'arraybuffer';

  const promise = new Promise<any>((resolve, reject) => {
    xhr.onload = () => {
      arrayBufferToImage(xhr.response as ArrayBuffer)
        .then((image) => resolve(createImage(image, imageId)))
        .catch(reject);
    };

    xhr.onerror = (error) => reject(error);
    xhr.send();
  });

  const cancelFn = () => xhr.abort();

  return { promise, cancelFn };
}

function getUri(imageId: string) {
  return imageId.startsWith('web:') ? imageId.slice(4) : imageId;
}

function webImageLoader(imageId: string, options?: WebLoaderOptions) {
  const uri = getUri(imageId);

  const promise = new Promise<any>((resolve, reject) => {
    loadImage(uri, imageId)
      .promise.then((image) => {
        if (options?.targetBuffer) {
          image.getPixelData(options.targetBuffer);
          resolve(true);
          return;
        }

        resolve(image);
      })
      .catch(reject);
  });

  return {
    promise,
    cancelFn: undefined,
  };
}

export function registerWebImageLoader(): void {
  registerImageLoader('web', webImageLoader as any);
}
