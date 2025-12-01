/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import fs from 'fs';
import path from 'path';
import { Snapshotter } from '../../../../playwright-core/src/server/trace/recorder/snapshotter';
import { HarTracer } from '../../../../playwright-core/src/server/har/harTracer';
import type { SnapshotterDelegate, SnapshotterBlob } from '../../../../playwright-core/src/server/trace/recorder/snapshotter';
import type { HarTracerDelegate } from '../../../../playwright-core/src/server/har/harTracer';
import type { BrowserContext } from '../../../../playwright-core/src/server/browserContext';
import type { FrameSnapshot } from '@trace/snapshot';
import type * as har from '@trace/har';

/**
 * SimpleSessionRecorder - Captures browser session data for vectorization
 *
 * Uses Playwright's Snapshotter and HarTracer directly without the complexity
 * of the full tracing system. Captures:
 * - Interactive HTML snapshots (with shadow DOM, computed styles, embedded resources)
 * - HTTP requests/responses (full HAR data)
 * - Resource blobs (images, CSS, fonts)
 *
 * Data is stored in a simple, vectorization-friendly format.
 */
export class SimpleSessionRecorder implements SnapshotterDelegate, HarTracerDelegate {
  private _snapshotter: InstanceType<typeof Snapshotter>;
  private _harTracer: InstanceType<typeof HarTracer>;
  private _snapshots = new Map<string, FrameSnapshot>();
  private _blobs = new Map<string, Buffer>();
  private _harEntries: har.Entry[] = [];
  private _outputDir: string;
  private _sessionStartTime: number;
  private _disposed = false;

  constructor(serverContext: BrowserContext, outputDir: string) {
    this._outputDir = outputDir;
    this._sessionStartTime = Date.now();

    // Create Snapshotter (captures interactive HTML with shadow DOM, computed styles, etc.)
    // Snapshotter only takes 2 args: context and delegate
    this._snapshotter = new Snapshotter(serverContext, this);

    // Create HarTracer (captures HTTP requests/responses)
    // HarTracer takes 4 args: context, page, delegate, options
    this._harTracer = new HarTracer(
        serverContext,
        null, // page - null means capture for all pages
        this,
        {
          content: 'embed',          // Embed bodies
          includeTraceInfo: true,
          recordRequestOverrides: true,    // Required field
          waitForContentOnStop: true
        }
    );
  }

  async start(): Promise<void> {
    await this._snapshotter.start();
    this._harTracer.start({ omitScripts: false });
  }

  async stop(): Promise<void> {
    if (this._disposed)
      return;

    this._snapshotter.stop();
    await this._harTracer.stop();
    await this._harTracer.flush();
  }

  async dispose(): Promise<void> {
    if (this._disposed)
      return;

    await this.stop();

    if (this._snapshotter)
      this._snapshotter.dispose();
    // HarTracer doesn't have a dispose method

    this._disposed = true;
  }

  // SnapshotterDelegate implementation
  onFrameSnapshot(snapshot: FrameSnapshot): void {
    this._snapshots.set(snapshot.snapshotName || String(this._snapshots.size), snapshot);
  }

  onSnapshotterBlob(blob: SnapshotterBlob): void {
    this._blobs.set(blob.sha1, blob.buffer);
  }

  // HarTracerDelegate implementation
  onEntryStarted(entry: har.Entry): void {
    // Entry started, not yet complete
  }

  onEntryFinished(entry: har.Entry): void {
    this._harEntries.push(entry);
  }

  onContentBlob(sha1: string, buffer: Buffer): void {
    this._blobs.set(sha1, buffer);
  }

  /**
   * Save session to disk in vectorization-friendly format
   */
  async saveSession(sessionName: string): Promise<string> {
    const sessionDir = path.join(this._outputDir, sessionName);
    const blobsDir = path.join(sessionDir, `${sessionName}_blobs`);

    // Create directories
    await fs.promises.mkdir(sessionDir, { recursive: true });
    await fs.promises.mkdir(blobsDir, { recursive: true });

    // Save blobs
    const blobManifest: Array<{ sha1: string; size: number; path: string; }> = [];
    for (const [sha1, buffer] of this._blobs) {
      const blobPath = path.join(blobsDir, sha1);
      await fs.promises.writeFile(blobPath, buffer);
      blobManifest.push({
        sha1,
        size: buffer.length,
        path: path.relative(sessionDir, blobPath)
      });
    }

    // Prepare session data
    const sessionData = {
      metadata: {
        sessionName,
        startTime: this._sessionStartTime,
        endTime: Date.now(),
        duration: Date.now() - this._sessionStartTime,
        capturedAt: new Date().toISOString()
      },
      snapshots: Array.from(this._snapshots.values()).map(s => ({
        name: s.snapshotName,
        url: s.frameUrl,
        timestamp: s.timestamp,
        html: s.html,
        resourceOverrides: s.resourceOverrides || []
      })),
      harEntries: this._harEntries,
      blobs: blobManifest
    };

    // Save session JSON
    const sessionPath = path.join(sessionDir, `${sessionName}.json`);
    await fs.promises.writeFile(
        sessionPath,
        JSON.stringify(sessionData, null, 2),
        'utf-8'
    );

    return sessionPath;
  }

  /**
   * Get summary statistics
   */
  getSummary() {
    const urls = new Set<string>();
    const domains = new Map<string, number>();

    for (const snapshot of this._snapshots.values()) {
      if (snapshot.frameUrl)
        urls.add(snapshot.frameUrl);
    }

    for (const entry of this._harEntries) {
      try {
        const url = new URL(entry.request.url);
        const domain = url.hostname;
        domains.set(domain, (domains.get(domain) || 0) + 1);
      } catch {
        // Invalid URL, skip
      }
    }

    const totalBlobSize = Array.from(this._blobs.values()).reduce((sum, buf) => sum + buf.length, 0);

    return {
      sessionDuration: `${((Date.now() - this._sessionStartTime) / 1000).toFixed(1)}s`,
      totalSnapshots: this._snapshots.size,
      uniqueUrls: urls.size,
      urls: Array.from(urls),
      totalBlobs: this._blobs.size,
      totalBlobSize,
      totalHarEntries: this._harEntries.length,
      requestsByDomain: Object.fromEntries(domains)
    };
  }
}
