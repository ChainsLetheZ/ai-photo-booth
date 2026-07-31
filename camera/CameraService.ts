export type CameraStatus =
  | 'idle'
  | 'starting'
  | 'ready'
  | 'blocked'
  | 'unavailable'
  | 'error';

export interface CameraService {
  start(): Promise<void>;
  stop(): void;
  getVideoElement(): HTMLVideoElement | null;
  captureFrame(): Promise<Blob>;
  getStatus(): CameraStatus;
}

export class BrowserCameraService implements CameraService {
  private stream: MediaStream | null = null;
  private status: CameraStatus = 'idle';

  constructor(private readonly video: HTMLVideoElement) {}

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.status = 'unavailable';
      throw new Error('Camera APIs are unavailable in this browser.');
    }

    this.status = 'starting';
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1440 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30, min: 20 },
        },
        audio: false,
      });
      this.video.srcObject = this.stream;
      await this.video.play();
      this.status = 'ready';
    } catch (error) {
      this.status =
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'blocked'
          : 'error';
      throw error;
    }
  }

  stop() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.status = 'idle';
  }

  getVideoElement() {
    return this.video;
  }

  getStatus() {
    return this.status;
  }

  async captureFrame(): Promise<Blob> {
    if (this.status !== 'ready' || this.video.readyState < 2) {
      throw new Error('Camera is not ready for capture.');
    }

    const canvas = document.createElement('canvas');
    canvas.width = this.video.videoWidth || 1280;
    canvas.height = this.video.videoHeight || 960;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable.');
    context.drawImage(this.video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.92);
    });
    if (!blob) throw new Error('Unable to encode the captured frame.');
    return blob;
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read image.'));
    reader.readAsDataURL(blob);
  });
}
