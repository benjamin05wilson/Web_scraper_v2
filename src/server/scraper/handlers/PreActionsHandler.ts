// ============================================================================
// PRE-ACTIONS HANDLER
// ============================================================================
// Executes pre-scrape actions like dismissing popups, accepting cookies, etc.

import type { Page } from 'playwright';
import type { RecorderAction } from '../../../shared/types.js';

/**
 * Pre-actions configuration
 */
export interface PreActionsConfig {
  /** List of actions to execute */
  actions: RecorderAction[];
  /** Whether to block navigation during pre-actions */
  blockNavigation?: boolean;
  /** Timeout for each action in ms */
  actionTimeout?: number;
  /** Delay between actions in ms */
  delayBetweenActions?: number;
}

/**
 * Result of pre-action execution
 */
export interface PreActionResult {
  /** Whether the action was successful */
  success: boolean;
  /** The action that was executed */
  action: RecorderAction;
  /** Error message if failed */
  error?: string;
  /** Whether the action was skipped (element not found) */
  skipped?: boolean;
}

/**
 * Handles execution of pre-scrape actions
 */
export class PreActionsHandler {
  private page: Page;
  private config: Required<PreActionsConfig>;
  private results: PreActionResult[];

  constructor(page: Page, config: PreActionsConfig) {
    this.page = page;
    this.config = {
      actions: config.actions || [],
      blockNavigation: config.blockNavigation ?? true,
      actionTimeout: config.actionTimeout ?? 3000,
      delayBetweenActions: config.delayBetweenActions ?? 200,
    };
    this.results = [];
  }

  /**
   * Execute all pre-actions
   * Returns array of results for each action
   */
  async execute(): Promise<PreActionResult[]> {
    this.results = [];

    if (this.config.actions.length === 0) {
      return this.results;
    }

    console.log(
      `[PreActionsHandler] Executing ${this.config.actions.length} pre-actions`
    );

    const currentUrl = this.page.url();

    // Block navigation during pre-actions to prevent accidental redirects
    if (this.config.blockNavigation) {
      await this.page.route('**/*', async (route) => {
        const request = route.request();
        if (request.isNavigationRequest()) {
          const targetUrl = request.url();
          if (
            targetUrl === currentUrl ||
            targetUrl.startsWith(currentUrl + '#')
          ) {
            await route.continue();
          } else {
            console.log(
              `[PreActionsHandler] Blocked navigation: ${targetUrl}`
            );
            await route.abort('aborted');
          }
        } else {
          await route.continue();
        }
      });
    }

    try {
      for (const action of this.config.actions) {
        const result = await this.executeAction(action);
        this.results.push(result);

        if (result.success || result.skipped) {
          await new Promise((r) =>
            setTimeout(r, this.config.delayBetweenActions)
          );
        }
      }
    } finally {
      // Remove navigation blocking
      if (this.config.blockNavigation) {
        await this.page.unroute('**/*');
      }
    }

    const successful = this.results.filter((r) => r.success).length;
    const skipped = this.results.filter((r) => r.skipped).length;
    console.log(
      `[PreActionsHandler] Completed: ${successful} successful, ${skipped} skipped, ${this.results.length - successful - skipped} failed`
    );

    return this.results;
  }

  /**
   * Execute a single pre-action
   */
  private async executeAction(action: RecorderAction): Promise<PreActionResult> {
    console.log(
      `[PreActionsHandler] ${action.type} on ${action.selector}`
    );

    try {
      // Check if element exists first
      const exists = await this.page
        .waitForSelector(action.selector, {
          timeout: this.config.actionTimeout,
          state: 'visible',
        })
        .then(() => true)
        .catch(() => false);

      if (!exists) {
        console.log(
          `[PreActionsHandler] Element not found, skipping: ${action.selector}`
        );
        return {
          success: false,
          action,
          skipped: true,
        };
      }

      switch (action.type) {
        case 'click':
          await this.page.click(action.selector, {
            timeout: this.config.actionTimeout,
          });
          break;

        case 'type':
          if (action.value) {
            await this.page.fill(action.selector, action.value, {
              timeout: this.config.actionTimeout,
            });
          }
          break;

        case 'select':
          if (action.value) {
            await this.page.selectOption(action.selector, action.value, {
              timeout: this.config.actionTimeout,
            });
          }
          break;

        case 'wait': {
          // Wait for specific time or element
          const waitValue = action.value;
          if (waitValue && !isNaN(parseInt(waitValue))) {
            await new Promise((r) => setTimeout(r, parseInt(waitValue)));
          } else if (action.selector) {
            await this.page.waitForSelector(action.selector, {
              timeout: this.config.actionTimeout,
            });
          }
          break;
        }

        case 'scroll':
          await this.page.evaluate((selector) => {
            const el = document.querySelector(selector);
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }, action.selector);
          break;

        default:
          console.warn(
            `[PreActionsHandler] Unknown action type: ${action.type}`
          );
      }

      return {
        success: true,
        action,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(
        `[PreActionsHandler] Action failed (non-fatal): ${message}`
      );
      return {
        success: false,
        action,
        error: message,
      };
    }
  }

  /**
   * Get results of executed actions
   */
  getResults(): PreActionResult[] {
    return [...this.results];
  }

  /**
   * Check if all required actions succeeded
   */
  allSuccessful(): boolean {
    return this.results.every((r) => r.success || r.skipped);
  }
}
