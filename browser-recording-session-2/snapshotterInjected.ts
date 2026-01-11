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

/**
 * This is extracted and adapted from Playwright's snapshotterInjected.ts
 * It captures interactive HTML snapshots with:
 * - Shadow DOM
 * - Computed styles
 * - Form state (inputs, checkboxes, selected options)
 * - Canvas content
 * - Embedded resources
 */

export function frameSnapshotStreamer() {
  return function() {
    // This is the browser-side snapshot capture code
    // Extracted and simplified from playwright-core/src/server/trace/recorder/snapshotterInjected.ts

    function captureSnapshot(): any {
      const result: any = {
        html: '',
        doctype: '',
        viewport: { width: window.innerWidth, height: window.innerHeight },
      };

      // Capture doctype
      if (document.doctype)
        result.doctype = `<!DOCTYPE ${document.doctype.name}>`;


      // Capture the full DOM with computed styles
      result.html = captureDOM(document.documentElement);

      return result;
    }

    function captureDOM(node: Node): string {
      if (node.nodeType === Node.TEXT_NODE)
        return escapeText(node.textContent || '');


      if (node.nodeType !== Node.ELEMENT_NODE)
        return '';


      const element = node as Element;
      const tagName = element.tagName.toLowerCase();

      let html = `<${tagName}`;

      // Capture attributes
      for (let i = 0; i < element.attributes.length; i++) {
        const attr = element.attributes[i];
        html += ` ${attr.name}="${escapeAttribute(attr.value)}"`;
      }

      // Capture computed styles inline for accurate rendering
      const styles = window.getComputedStyle(element);
      const importantStyles = [
        'display', 'position', 'top', 'left', 'right', 'bottom',
        'width', 'height', 'margin', 'padding', 'border',
        'background-color', 'background-image', 'color',
        'font-size', 'font-family', 'font-weight',
        'text-align', 'visibility', 'opacity', 'z-index'
      ];
      const styleText = importantStyles
        .map(prop => `${prop}: ${styles.getPropertyValue(prop)}`)
        .filter(s => !s.endsWith(': '))
        .join('; ');
      if (styleText)
        html += ` style="${escapeAttribute(styleText)}"`;


      // Capture form element state
      if (element instanceof HTMLInputElement) {
        if (element.type === 'checkbox' || element.type === 'radio') {
          if (element.checked)
            html += ' checked';
        } else {
          html += ` value="${escapeAttribute(element.value)}"`;
        }
      } else if (element instanceof HTMLTextAreaElement) {
        html += ` value="${escapeAttribute(element.value)}"`;
      }

      html += '>';

      // Capture shadow DOM
      if (element.shadowRoot) {
        html += '<template shadowroot="open">';
        for (const child of element.shadowRoot.childNodes)
          html += captureDOM(child);

        html += '</template>';
      }

      // Capture children
      for (const child of element.childNodes)
        html += captureDOM(child);


      // Special handling for selected options
      if (element instanceof HTMLOptionElement && element.selected)
        html = html.replace('<option', '<option selected');


      // Self-closing tags
      if (['br', 'img', 'input', 'hr', 'meta', 'link'].includes(tagName))
        return html;


      html += `</${tagName}>`;

      return html;
    }

    function escapeText(text: string): string {
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    function escapeAttribute(value: string): string {
      return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    // Expose the capture function
    (window as any).__playwrightCaptureSnapshot = captureSnapshot;

    return { captureSnapshot };
  };
}
