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

// This is a standalone version of the snapshotter extracted from Playwright's
// packages/playwright-core/src/server/trace/recorder/snapshotterInjected.ts

(function() {
  if ((window as any).__playwrightCaptureSnapshot)
    return;

  const kShadowAttribute = '__playwright_shadow_root_';
  const kValueAttribute = '__playwright_value_';
  const kCheckedAttribute = '__playwright_checked_';
  const kSelectedAttribute = '__playwright_selected_';
  const kScrollTopAttribute = '__playwright_scroll_top_';
  const kScrollLeftAttribute = '__playwright_scroll_left_';

  class Snapshotter {
    private _fakeBase: HTMLBaseElement;

    constructor() {
      this._fakeBase = document.createElement('base');
    }

    private _sanitizeUrl(url: string): string {
      if (url.startsWith('javascript:') || url.startsWith('vbscript:'))
        return '';
      return url;
    }

    private _sanitizeSrcSet(srcset: string): string {
      return srcset.split(',').map(src => {
        src = src.trim();
        const spaceIndex = src.lastIndexOf(' ');
        if (spaceIndex === -1)
          return this._sanitizeUrl(src);
        return this._sanitizeUrl(src.substring(0, spaceIndex).trim()) + src.substring(spaceIndex);
      }).join(', ');
    }

    private _resolveUrl(base: string, url: string): string {
      if (url === '')
        return '';
      try {
        return new URL(url, base).href;
      } catch (e) {
        return url;
      }
    }

    private _getSheetBase(sheet: CSSStyleSheet): string {
      let rootSheet = sheet;
      while (rootSheet.parentStyleSheet)
        rootSheet = rootSheet.parentStyleSheet;
      if (rootSheet.ownerNode)
        return rootSheet.ownerNode.baseURI;
      return document.baseURI;
    }

    private _getSheetText(sheet: CSSStyleSheet): string {
      const rules: string[] = [];
      for (let i = 0; i < sheet.cssRules.length; i++)
        rules.push(sheet.cssRules[i].cssText);
      return rules.join('\n');
    }

    captureSnapshot(): string {
      const { doctype, html } = this._captureSnapshot();
      return (doctype || '') + html;
    }

    private _captureSnapshot(): { doctype: string | null, html: string } {
      const removedScripts: HTMLScriptElement[] = [];
      if (true) {
        const scripts = Array.from(document.scripts);
        for (const script of scripts) {
          if (script.parentElement) {
            script.parentElement.removeChild(script);
            removedScripts.push(script);
          }
        }
      }

      const snapshot = this._serializeNode(document.documentElement, document.baseURI);

      for (const script of removedScripts) {
        if (script.parentElement)
          script.parentElement.insertBefore(script, script.nextSibling);
      }

      let doctype = '';
      if (document.doctype)
        doctype = new XMLSerializer().serializeToString(document.doctype);
      return { doctype, html: snapshot };
    }

    private _serializeNode(node: Node, baseURI: string): string {
      const nodeType = node.nodeType;
      const nodeName = node.nodeName;

      if (nodeType === Node.TEXT_NODE)
        return this._escapeText(node.nodeValue || '');
      if (nodeType === Node.COMMENT_NODE)
        return `<!--${node.nodeValue}-->`;
      if (nodeName === 'SCRIPT' || nodeName === 'NOSCRIPT')
        return '';

      let attrs = '';
      if (nodeType === Node.ELEMENT_NODE) {
        const element = node as HTMLElement;
        for (let i = 0; i < element.attributes.length; i++) {
          const attr = element.attributes[i];
          const name = attr.name;
          let value = attr.value;
          if (name === 'value' && (nodeName === 'INPUT' || nodeName === 'TEXTAREA'))
            continue;
          if (name === 'checked' && nodeName === 'INPUT')
            continue;
          if (name === 'selected' && nodeName === 'OPTION')
            continue;
          if (name === 'src' || name === 'href')
            value = this._resolveUrl(baseURI, value);
          else if (name === 'srcset')
            value = this._sanitizeSrcSet(value);
          else if (name === 'style')
            value = element.style.cssText;
          attrs += ` ${name}="${this._escapeAttribute(value)}"`;
        }
        if (nodeName === 'INPUT') {
          attrs += ` ${kValueAttribute}="${this._escapeAttribute((node as HTMLInputElement).value)}"`;
          if ((node as HTMLInputElement).checked)
            attrs += ` ${kCheckedAttribute}`;
        } else if (nodeName === 'TEXTAREA') {
          attrs += ` ${kValueAttribute}="${this._escapeAttribute((node as HTMLTextAreaElement).value)}"`;
        } else if (nodeName === 'OPTION') {
          if ((node as HTMLOptionElement).selected)
            attrs += ` ${kSelectedAttribute}`;
        }
        attrs += ` ${kScrollLeftAttribute}="${element.scrollLeft}"`;
        attrs += ` ${kScrollTopAttribute}="${element.scrollTop}"`;

        if (element.shadowRoot)
          attrs += ` ${kShadowAttribute}`;
      }

      let content = '';
      if (nodeName === 'STYLE') {
        try {
          const sheet = (node as HTMLStyleElement).sheet;
          if (sheet)
            content = this._getSheetText(sheet);
        } catch (e) {
          // Cross-origin style sheet.
        }
      } else {
        const childNodes = node.childNodes;
        for (let i = 0; i < childNodes.length; ++i)
          content += this._serializeNode(childNodes[i], baseURI);
      }

      if (nodeType === Node.ELEMENT_NODE && (node as Element).shadowRoot) {
        const shadowRoot = (node as Element).shadowRoot!;
        let shadowContent = '';
        for (let child = shadowRoot.firstChild; child; child = child.nextSibling)
          shadowContent += this._serializeNode(child, shadowRoot.baseURI);
        content += `<template shadowroot="open">${shadowContent}</template>`;
      }

      const selfClosing = ['AREA', 'BASE', 'BR', 'COL', 'EMBED', 'HR', 'IMG', 'INPUT', 'LINK', 'META', 'PARAM', 'SOURCE', 'TRACK', 'WBR'];
      if (selfClosing.includes(nodeName))
        return `<${nodeName}${attrs}/>`;

      return `<${nodeName.toLowerCase()}${attrs}>${content}</${nodeName.toLowerCase()}>`;
    }

    private _escapeAttribute(s: string): string {
      return s.replace(/"/g, '&quot;');
    }

    private _escapeText(s: string): string {
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  }

  (window as any).__playwrightCaptureSnapshot = () => {
    const snapshotter = new Snapshotter();
    return snapshotter.captureSnapshot();
  };
})();
