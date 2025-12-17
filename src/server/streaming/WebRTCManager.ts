// ============================================================================
// WEBRTC MANAGER - Low-Latency Browser Streaming
// ============================================================================
// Uses Chrome's Tab Capture API via extension for hardware-accelerated capture

import type { Page, CDPSession } from 'playwright';
import { EventEmitter } from 'events';
import { WEBRTC_ENCODING_CONFIG, TAB_CAPTURE_CONFIG } from '../config/chrome-flags.js';

// CDP Screencast configuration for development
const SCREENCAST_CONFIG = {
  format: 'jpeg' as const,
  quality: 80,
  maxWidth: 1920,
  maxHeight: 1080,
  everyNthFrame: 1,
};

export interface StreamConfig {
  width: number;
  height: number;
  frameRate: number;
  bitrate: number;
}

export class WebRTCManager extends EventEmitter {
  private page: Page;
  private cdp: CDPSession;
  private isStreaming: boolean = false;
  private streamConfig: StreamConfig;
  private frameCallback?: (frame: Buffer, timestamp: number) => void;

  constructor(page: Page, cdp: CDPSession, config?: Partial<StreamConfig>) {
    super();
    this.page = page;
    this.cdp = cdp;
    this.streamConfig = {
      width: config?.width || TAB_CAPTURE_CONFIG.maxWidth,
      height: config?.height || TAB_CAPTURE_CONFIG.maxHeight,
      frameRate: config?.frameRate || TAB_CAPTURE_CONFIG.maxFrameRate,
      bitrate: config?.bitrate || WEBRTC_ENCODING_CONFIG.video.maxBitrate,
    };
  }

  // =========================================================================
  // CDP SCREENCAST - Development/Fallback Method
  // =========================================================================
  // Note: For production with true sub-frame latency, use Tab Capture Extension

  async startScreencast(): Promise<void> {
    if (this.isStreaming) return;

    console.log('[WebRTCManager] Starting CDP screencast');

    // Listen for screencast frames
    this.cdp.on('Page.screencastFrame', async (params) => {
      const { data, metadata, sessionId } = params;

      // Acknowledge frame receipt immediately for lowest latency
      await this.cdp.send('Page.screencastFrameAck', { sessionId });

      // Decode base64 frame
      const frameBuffer = Buffer.from(data, 'base64');

      // Emit frame with timestamp
      const timestamp = metadata.timestamp ?? Date.now();
      this.emit('frame', frameBuffer, timestamp);
      this.frameCallback?.(frameBuffer, timestamp);
    });

    // Start screencast
    await this.cdp.send('Page.startScreencast', {
      format: SCREENCAST_CONFIG.format,
      quality: SCREENCAST_CONFIG.quality,
      maxWidth: this.streamConfig.width,
      maxHeight: this.streamConfig.height,
      everyNthFrame: SCREENCAST_CONFIG.everyNthFrame,
    });

    this.isStreaming = true;
    console.log('[WebRTCManager] CDP screencast started');
  }

  async stopScreencast(): Promise<void> {
    if (!this.isStreaming) return;

    await this.cdp.send('Page.stopScreencast');
    this.isStreaming = false;
    console.log('[WebRTCManager] CDP screencast stopped');
  }

  setFrameCallback(callback: (frame: Buffer, timestamp: number) => void): void {
    this.frameCallback = callback;
  }

  // =========================================================================
  // TAB CAPTURE VIA CDP CAST - Production Method
  // =========================================================================
  // This uses Chrome's native tab capture with hardware encoding

  async startTabCapture(): Promise<{ streamId: string } | null> {
    console.log('[WebRTCManager] Starting tab capture via CDP');

    try {
      // Get target ID for this page
      const targets = await this.cdp.send('Target.getTargets' as any);
      const pageTarget = targets.targetInfos?.find(
        (t: any) => t.type === 'page' && t.url === this.page.url()
      );

      if (!pageTarget) {
        console.error('[WebRTCManager] Could not find page target');
        return null;
      }

      // Request desktop media via CDP
      // Note: This requires user gesture in the browser
      const streamId = await this.page.evaluate(() => {
        return new Promise<string>((resolve, reject) => {
          // @ts-ignore - Chrome extension API
          const chromeApi = (window as any).chrome;
          if (typeof chromeApi !== 'undefined' && chromeApi.tabCapture) {
            chromeApi.tabCapture.capture(
              {
                audio: false,
                video: true,
                videoConstraints: {
                  mandatory: {
                    chromeMediaSource: 'tab',
                    maxWidth: 1920,
                    maxHeight: 1080,
                    maxFrameRate: 60,
                  },
                },
              },
              (stream: MediaStream) => {
                if (stream) {
                  // Return stream ID
                  resolve(stream.id);
                } else {
                  reject(new Error('Tab capture failed'));
                }
              }
            );
          } else {
            // Fallback: Use getDisplayMedia with preferCurrentTab
            navigator.mediaDevices
              .getDisplayMedia({
                video: {
                  // @ts-ignore - Chrome-specific
                  displaySurface: 'browser',
                  frameRate: { ideal: 60, max: 60 },
                  width: { ideal: 1920 },
                  height: { ideal: 1080 },
                },
                audio: false,
                // @ts-ignore - Chrome-specific
                preferCurrentTab: true,
                selfBrowserSurface: 'include',
              })
              .then((stream) => resolve(stream.id))
              .catch(reject);
          }
        });
      });

      console.log('[WebRTCManager] Tab capture stream:', streamId);
      return { streamId };
    } catch (error) {
      console.error('[WebRTCManager] Tab capture error:', error);
      return null;
    }
  }

  // =========================================================================
  // WEBRTC PEER CONNECTION
  // =========================================================================

  async createPeerConnection(
    onIceCandidate: (candidate: RTCIceCandidateInit) => void
  ): Promise<{
    createOffer: () => Promise<RTCSessionDescriptionInit>;
    setRemoteDescription: (answer: RTCSessionDescriptionInit) => Promise<void>;
    addIceCandidate: (candidate: RTCIceCandidateInit) => Promise<void>;
  }> {
    // This runs in the browser context
    const pcId = await this.page.evaluate(() => {
      const id = 'pc_' + Math.random().toString(36).substr(2, 9);

      // Create peer connection with optimal settings
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        // @ts-ignore - Chrome specific
        sdpSemantics: 'unified-plan',
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
      });

      // Store globally for access
      (window as any).__rtcPeerConnections = (window as any).__rtcPeerConnections || {};
      (window as any).__rtcPeerConnections[id] = pc;

      return id;
    });

    // Set up ICE candidate callback
    await this.page.exposeFunction('__rtcOnIceCandidate_' + pcId, onIceCandidate);

    await this.page.evaluate((id) => {
      const pc = (window as any).__rtcPeerConnections[id];
      pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
        if (event.candidate) {
          (window as any)['__rtcOnIceCandidate_' + id](event.candidate.toJSON());
        }
      };
    }, pcId);

    return {
      createOffer: async () => {
        return await this.page.evaluate(async (id) => {
          const pc = (window as any).__rtcPeerConnections[id];

          // Get media stream (either from tab capture or display media)
          let stream: MediaStream;
          try {
            stream = await navigator.mediaDevices.getDisplayMedia({
              video: {
                // @ts-ignore
                displaySurface: 'browser',
                frameRate: { ideal: 60, max: 60 },
                width: { ideal: 1920 },
                height: { ideal: 1080 },
              },
              audio: false,
              // @ts-ignore
              preferCurrentTab: true,
              selfBrowserSurface: 'include',
            });
          } catch {
            // Fallback to any screen
            stream = await navigator.mediaDevices.getDisplayMedia({
              video: {
                frameRate: { ideal: 60, max: 60 },
                width: { ideal: 1920 },
                height: { ideal: 1080 },
              },
              audio: false,
            });
          }

          // Add tracks to peer connection
          stream.getTracks().forEach((track) => {
            const sender = pc.addTrack(track, stream);

            // Configure encoding parameters for low latency
            const params = sender.getParameters();
            if (params.encodings && params.encodings.length > 0) {
              params.encodings[0].maxBitrate = 8000000; // 8 Mbps
              params.encodings[0].maxFramerate = 60;
              // @ts-ignore
              params.encodings[0].networkPriority = 'high';
              sender.setParameters(params);
            }
          });

          // Create offer with low-latency settings
          const offer = await pc.createOffer({
            offerToReceiveAudio: false,
            offerToReceiveVideo: false,
          });

          // Modify SDP for low latency
          let sdp = offer.sdp || '';

          // Prefer H264 for hardware encoding
          sdp = sdp.replace(
            /m=video (\d+) UDP\/TLS\/RTP\/SAVPF ([\d ]+)/,
            (fullMatch: string, port: string, codecs: string) => {
              const codecList = codecs.split(' ');
              // Find H264 payload type
              const h264Match = sdp.match(/a=rtpmap:(\d+) H264/);
              if (h264Match) {
                const h264Pt = h264Match[1];
                // Move H264 to front
                const reordered = [h264Pt, ...codecList.filter((c: string) => c !== h264Pt)];
                return `m=video ${port} UDP/TLS/RTP/SAVPF ${reordered.join(' ')}`;
              }
              return fullMatch;
            }
          );

          // Add low-latency RTP extensions if not present
          if (!sdp.includes('transport-cc')) {
            sdp = sdp.replace(
              /a=extmap:(\d+)/,
              'a=extmap:$1 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01\r\na=extmap:$1'
            );
          }

          await pc.setLocalDescription({ type: 'offer', sdp });

          return { type: 'offer' as const, sdp: pc.localDescription?.sdp };
        }, pcId);
      },

      setRemoteDescription: async (answer: RTCSessionDescriptionInit) => {
        await this.page.evaluate(
          async ({ id, answer }) => {
            const pc = (window as any).__rtcPeerConnections[id];
            await pc.setRemoteDescription(answer);
          },
          { id: pcId, answer }
        );
      },

      addIceCandidate: async (candidate: RTCIceCandidateInit) => {
        await this.page.evaluate(
          async ({ id, candidate }) => {
            const pc = (window as any).__rtcPeerConnections[id];
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          },
          { id: pcId, candidate }
        );
      },
    };
  }

  // =========================================================================
  // CONFIGURATION
  // =========================================================================

  updateConfig(config: Partial<StreamConfig>): void {
    this.streamConfig = { ...this.streamConfig, ...config };
  }

  getConfig(): StreamConfig {
    return { ...this.streamConfig };
  }

  isActive(): boolean {
    return this.isStreaming;
  }
}
