// ============================================================================
// INTERACTION RECORDER - Strict DOM Mode
// ============================================================================
// Records user interactions with exact selectors - NO coordinates, NO heuristics

import type { Page, CDPSession } from 'playwright';
import { v4 as uuid } from 'uuid';
import type { RecorderAction, RecorderSequence, RecorderActionType } from '../../shared/types.js';

// Script injected for recording interactions
const RECORDER_SCRIPT = `
(function() {
  if (window.__scraperRecorderActive) return;
  window.__scraperRecorderActive = true;

  let isRecording = false;

  // Get robust selector for element (same as inspector)
  function getSelector(el) {
    if (!el || el === document.body || el === document.documentElement) {
      return el?.tagName?.toLowerCase() || 'body';
    }

    // Priority 1: ID selector
    if (el.id && !el.id.match(/^[0-9]/) && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) {
      return '#' + CSS.escape(el.id);
    }

    // Priority 2: Button/link with text
    if ((el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button')) {
      const text = el.textContent?.trim();
      if (text && text.length < 50) {
        // Playwright-style text selector
        const textSelector = el.tagName.toLowerCase() + ':has-text("' + text.replace(/"/g, '\\\\"') + '")';
        try {
          if (document.querySelectorAll(textSelector.replace(':has-text', '')).length < 10) {
            return textSelector;
          }
        } catch {}
      }
    }

    // Priority 3: aria-label
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) {
      const ariaSelector = '[aria-label="' + CSS.escape(ariaLabel) + '"]';
      if (document.querySelectorAll(ariaSelector).length === 1) {
        return ariaSelector;
      }
    }

    // Priority 4: data-testid or similar test attributes
    for (const attr of ['data-testid', 'data-test-id', 'data-cy', 'data-qa']) {
      const val = el.getAttribute(attr);
      if (val) {
        const testSelector = '[' + attr + '="' + CSS.escape(val) + '"]';
        if (document.querySelectorAll(testSelector).length === 1) {
          return testSelector;
        }
      }
    }

    // Priority 5: Unique class combination
    if (el.classList.length > 0) {
      const classes = Array.from(el.classList)
        .filter(c => !c.match(/^[0-9]/) && !c.includes('hover') && !c.includes('active') && !c.includes('focus'))
        .slice(0, 3)
        .map(c => '.' + CSS.escape(c))
        .join('');

      if (classes) {
        const classSelector = el.tagName.toLowerCase() + classes;
        if (document.querySelectorAll(classSelector).length === 1) {
          return classSelector;
        }
      }
    }

    // Priority 6: Build unique path
    const path = [];
    let current = el;
    let depth = 0;

    while (current && current !== document.body && depth < 5) {
      let selector = current.tagName.toLowerCase();

      if (current.id && !current.id.match(/^[0-9]/)) {
        selector = '#' + CSS.escape(current.id);
        path.unshift(selector);
        break;
      }

      // Add class if helpful
      const uniqueClass = Array.from(current.classList).find(c => {
        if (c.match(/^[0-9]/) || c.includes('hover')) return false;
        const sel = current.tagName.toLowerCase() + '.' + CSS.escape(c);
        return document.querySelectorAll(sel).length < 5;
      });

      if (uniqueClass) {
        selector += '.' + CSS.escape(uniqueClass);
      }

      // Add nth-of-type if needed
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += ':nth-of-type(' + index + ')';
        }
      }

      path.unshift(selector);
      current = current.parentElement;
      depth++;
    }

    return path.join(' > ');
  }

  // Describe action for logging
  function describeElement(el) {
    const tag = el.tagName.toLowerCase();
    const text = el.textContent?.trim().substring(0, 30);
    const ariaLabel = el.getAttribute('aria-label');
    const placeholder = el.getAttribute('placeholder');

    if (ariaLabel) return ariaLabel;
    if (placeholder) return placeholder;
    if (text) return text + (el.textContent.trim().length > 30 ? '...' : '');
    return tag;
  }

  // Record click
  function onClickCapture(e) {
    if (!isRecording) return;

    const el = e.target;
    if (!el || el.id?.startsWith('__scraper')) return;

    const selector = getSelector(el);
    const description = describeElement(el);

    window.__scraperRecordAction?.({
      type: 'click',
      selector,
      description: 'Click on "' + description + '"'
    });
  }

  // Record input
  function onInputCapture(e) {
    if (!isRecording) return;

    const el = e.target;
    if (!el || el.id?.startsWith('__scraper')) return;
    if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && !el.isContentEditable) return;

    // Debounce rapid typing - only record final value
    clearTimeout(el.__scraperInputTimeout);
    el.__scraperInputTimeout = setTimeout(() => {
      const selector = getSelector(el);
      const value = el.value || el.textContent || '';
      const description = describeElement(el);

      window.__scraperRecordAction?.({
        type: 'type',
        selector,
        value,
        description: 'Type "' + value.substring(0, 20) + '" into "' + description + '"'
      });
    }, 500);
  }

  // Record select (dropdown)
  function onChangeCapture(e) {
    if (!isRecording) return;

    const el = e.target;
    if (!el || el.tagName !== 'SELECT') return;

    const selector = getSelector(el);
    const value = el.value;
    const selectedText = el.options[el.selectedIndex]?.text || value;

    window.__scraperRecordAction?.({
      type: 'select',
      selector,
      value,
      description: 'Select "' + selectedText + '"'
    });
  }

  // Public API
  window.__scraperRecorder = {
    start() {
      isRecording = true;
      document.addEventListener('click', onClickCapture, true);
      document.addEventListener('input', onInputCapture, true);
      document.addEventListener('change', onChangeCapture, true);
      console.log('[Recorder] Started');
    },

    stop() {
      isRecording = false;
      document.removeEventListener('click', onClickCapture, true);
      document.removeEventListener('input', onInputCapture, true);
      document.removeEventListener('change', onChangeCapture, true);
      console.log('[Recorder] Stopped');
    },

    isRecording() {
      return isRecording;
    }
  };
})();
`;

export class InteractionRecorder {
  private page: Page;
  private isRecording: boolean = false;
  private currentSequence: RecorderSequence | null = null;
  private sequences: Map<string, RecorderSequence> = new Map();
  private onAction?: (action: RecorderAction) => void;
  private isCallbackExposed: boolean = false;

  constructor(page: Page, _cdp: CDPSession) {
    this.page = page;
  }

  async inject(): Promise<void> {
    // Inject recorder script
    await this.page.evaluate(RECORDER_SCRIPT);

    // Set up action callback - only expose once per page context
    if (!this.isCallbackExposed) {
      try {
        await this.page.exposeFunction('__scraperRecordAction', (rawAction: {
          type: RecorderActionType;
          selector: string;
          value?: string;
          description: string;
        }) => {
          if (!this.currentSequence) return;

          const action: RecorderAction = {
            id: uuid(),
            type: rawAction.type,
            selector: rawAction.selector,
            value: rawAction.value,
            timestamp: Date.now(),
            description: rawAction.description,
          };

          // Validate selector before recording
          this.validateAndAddAction(action);
        });
        this.isCallbackExposed = true;
      } catch (e) {
        // Function already exposed - this is fine
        if (!(e instanceof Error && e.message.includes('has been already registered'))) {
          throw e;
        }
      }
    }

    console.log('[InteractionRecorder] Injected');
  }

  private async validateAndAddAction(action: RecorderAction): Promise<void> {
    if (!this.currentSequence) return;

    // Validate selector exists
    const exists = await this.page.evaluate((sel) => {
      try {
        // Handle :has-text() pseudo-selector for validation
        const cleanSelector = sel.replace(/:has-text\("[^"]*"\)/g, '');
        return document.querySelectorAll(cleanSelector).length > 0;
      } catch {
        return false;
      }
    }, action.selector);

    if (!exists) {
      console.warn(`[InteractionRecorder] Invalid selector, not recording: ${action.selector}`);
      return;
    }

    this.currentSequence.actions.push(action);
    this.onAction?.(action);

    console.log(`[InteractionRecorder] Recorded: ${action.type} on ${action.selector}`);
  }

  async startRecording(name: string, description?: string): Promise<RecorderSequence> {
    if (this.isRecording) {
      await this.stopRecording();
    }

    await this.inject();

    this.currentSequence = {
      id: uuid(),
      name,
      description,
      actions: [],
      createdAt: Date.now(),
    };

    await this.page.evaluate(() => {
      (window as any).__scraperRecorder?.start();
    });

    this.isRecording = true;
    console.log(`[InteractionRecorder] Recording started: ${name}`);

    return this.currentSequence;
  }

  async stopRecording(): Promise<RecorderSequence | null> {
    if (!this.isRecording || !this.currentSequence) {
      return null;
    }

    await this.page.evaluate(() => {
      (window as any).__scraperRecorder?.stop();
    });

    this.isRecording = false;
    const sequence = this.currentSequence;
    this.sequences.set(sequence.id, sequence);
    this.currentSequence = null;

    console.log(`[InteractionRecorder] Recording stopped: ${sequence.actions.length} actions`);
    return sequence;
  }

  setActionCallback(callback: (action: RecorderAction) => void): void {
    this.onAction = callback;
  }

  getSequence(id: string): RecorderSequence | undefined {
    return this.sequences.get(id);
  }

  getAllSequences(): RecorderSequence[] {
    return Array.from(this.sequences.values());
  }

  // =========================================================================
  // PLAYBACK - Execute recorded sequence
  // =========================================================================

  async playSequence(sequenceId: string): Promise<{ success: boolean; error?: string }> {
    const sequence = this.sequences.get(sequenceId);
    if (!sequence) {
      return { success: false, error: `Sequence ${sequenceId} not found` };
    }

    return this.executeActions(sequence.actions);
  }

  async executeActions(actions: RecorderAction[]): Promise<{ success: boolean; error?: string }> {
    console.log(`[InteractionRecorder] Executing ${actions.length} actions`);

    for (const action of actions) {
      try {
        await this.executeAction(action);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[InteractionRecorder] Action failed: ${action.type} on ${action.selector}`);
        return {
          success: false,
          error: `Action "${action.description}" failed: ${errorMessage}`,
        };
      }
    }

    return { success: true };
  }

  private async executeAction(action: RecorderAction): Promise<void> {
    const { type, selector, value } = action;

    // Handle Playwright-style :has-text() selector
    const hasTextMatch = selector.match(/:has-text\("([^"]*)"\)/);

    switch (type) {
      case 'click':
        if (hasTextMatch) {
          const [, text] = hasTextMatch;
          const baseSelector = selector.replace(/:has-text\("[^"]*"\)/, '');
          await this.page.locator(`${baseSelector}:has-text("${text}")`).click({ timeout: 5000 });
        } else {
          await this.page.click(selector, { timeout: 5000 });
        }
        break;

      case 'type':
        if (!value) break;
        // Clear existing value first
        await this.page.fill(selector, '', { timeout: 5000 });
        await this.page.fill(selector, value, { timeout: 5000 });
        break;

      case 'select':
        if (!value) break;
        await this.page.selectOption(selector, value, { timeout: 5000 });
        break;

      case 'scroll':
        await this.page.evaluate((sel) => {
          const el = document.querySelector(sel);
          el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, selector);
        break;

      case 'wait':
        await this.page.waitForSelector(selector, { timeout: 10000 });
        break;
    }

    // Small delay between actions for stability
    await new Promise((r) => setTimeout(r, 100));
  }

  // =========================================================================
  // MANUAL ACTION CREATION
  // =========================================================================

  addManualAction(sequenceId: string, action: Omit<RecorderAction, 'id' | 'timestamp'>): RecorderAction | null {
    const sequence = this.sequences.get(sequenceId);
    if (!sequence) return null;

    const fullAction: RecorderAction = {
      ...action,
      id: uuid(),
      timestamp: Date.now(),
    };

    sequence.actions.push(fullAction);
    return fullAction;
  }

  removeAction(sequenceId: string, actionId: string): boolean {
    const sequence = this.sequences.get(sequenceId);
    if (!sequence) return false;

    const index = sequence.actions.findIndex((a) => a.id === actionId);
    if (index === -1) return false;

    sequence.actions.splice(index, 1);
    return true;
  }

  reorderActions(sequenceId: string, actionIds: string[]): boolean {
    const sequence = this.sequences.get(sequenceId);
    if (!sequence) return false;

    const actionMap = new Map(sequence.actions.map((a) => [a.id, a]));
    const reordered: RecorderAction[] = [];

    for (const id of actionIds) {
      const action = actionMap.get(id);
      if (action) reordered.push(action);
    }

    sequence.actions = reordered;
    return true;
  }

  // =========================================================================
  // SERIALIZATION
  // =========================================================================

  exportSequence(sequenceId: string): string | null {
    const sequence = this.sequences.get(sequenceId);
    if (!sequence) return null;
    return JSON.stringify(sequence, null, 2);
  }

  importSequence(json: string): RecorderSequence | null {
    try {
      const sequence = JSON.parse(json) as RecorderSequence;
      sequence.id = uuid(); // Generate new ID
      this.sequences.set(sequence.id, sequence);
      return sequence;
    } catch {
      return null;
    }
  }
}
