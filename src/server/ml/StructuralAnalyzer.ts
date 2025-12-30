// ============================================================================
// STRUCTURAL ANALYZER - DOM pattern recognition for product detection
// ============================================================================

/**
 * Analyzes DOM structure patterns to find repeating product templates.
 * Used to boost confidence when elements share similar structures.
 */
export class StructuralAnalyzer {
  private maxDepth: number;

  constructor(maxDepth: number = 10) {
    this.maxDepth = maxDepth;
  }

  /**
   * Generate browser-side script to extract structural patterns
   * This runs in the browser context
   */
  getPatternExtractionScript(): string {
    return `
      (function() {
        const maxDepth = ${this.maxDepth};

        function getTagPath(el) {
          const path = [];
          let current = el;
          let depth = 0;

          while (current && current.tagName !== 'BODY' && depth < maxDepth) {
            path.unshift(current.tagName.toLowerCase());
            current = current.parentElement;
            depth++;
          }

          return path;
        }

        function extractClassPatterns(el) {
          // Extract meaningful class patterns, filtering out dynamic/state classes
          return Array.from(el.classList)
            .filter(cls => !cls.match(/^(hover|active|focus|selected|ng-|js-|_|[0-9])/) && !cls.includes('@') && !cls.includes('/'))
            .filter(cls => cls.length > 2 && cls.length < 50);
        }

        function hashChildStructure(el) {
          // Create a hash of immediate children structure
          const children = Array.from(el.children).slice(0, 5);
          const structure = children.map(c =>
            c.tagName + ':' + c.children.length + ':' + c.classList.length
          ).join('|');
          return structure;
        }

        function getNestingDepth(el) {
          let depth = 0;
          let current = el;
          while (current && current.tagName !== 'BODY') {
            depth++;
            current = current.parentElement;
          }
          return depth;
        }

        function simpleHash(str) {
          let hash = 0;
          for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
          }
          return hash.toString(16);
        }

        function getStructuralPattern(el) {
          const tagPath = getTagPath(el);
          const classPatterns = extractClassPatterns(el);
          const depth = getNestingDepth(el);
          const childStructure = hashChildStructure(el);

          // Create hash from pattern components
          const hashInput = tagPath.join('>') + '|' + classPatterns.sort().join(',') + '|' + childStructure;
          const hash = simpleHash(hashInput);

          return {
            tagPath,
            classPatterns,
            depth,
            childStructure,
            hash
          };
        }

        // Expose functions globally for use by ProductDetector
        window.__structuralAnalyzer = {
          getStructuralPattern,
          getTagPath,
          extractClassPatterns,
          hashChildStructure,
          getNestingDepth
        };

        return true;
      })()
    `;
  }

  /**
   * Generate script to analyze siblings for similarity
   */
  getSiblingAnalysisScript(selector: string, maxSiblings: number = 10): string {
    return `
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { count: 0, similarityScore: 0, gridLikelihood: 0 };

        const parent = el.parentElement;
        if (!parent) return { count: 0, similarityScore: 0, gridLikelihood: 0 };

        // Get siblings of same tag type
        const siblings = Array.from(parent.children).filter(child =>
          child !== el && child.tagName === el.tagName
        );

        if (siblings.length === 0) {
          return { count: 0, similarityScore: 0, gridLikelihood: 0 };
        }

        // Calculate structural similarity
        const analyzer = window.__structuralAnalyzer;
        if (!analyzer) {
          return { count: siblings.length, similarityScore: 0.5, gridLikelihood: 0.5 };
        }

        const elPattern = analyzer.getStructuralPattern(el);

        // Sample siblings for similarity calculation
        const samplesToCheck = siblings.slice(0, ${maxSiblings});
        let totalSimilarity = 0;

        for (const sibling of samplesToCheck) {
          const sibPattern = analyzer.getStructuralPattern(sibling);

          let similarity = 0;

          // Tag path similarity (40%)
          const maxPathLen = Math.max(elPattern.tagPath.length, sibPattern.tagPath.length);
          if (maxPathLen > 0) {
            let pathMatches = 0;
            for (let i = 0; i < Math.min(elPattern.tagPath.length, sibPattern.tagPath.length); i++) {
              if (elPattern.tagPath[i] === sibPattern.tagPath[i]) pathMatches++;
            }
            similarity += (pathMatches / maxPathLen) * 0.4;
          } else {
            similarity += 0.4;
          }

          // Class pattern similarity (30%) - Jaccard similarity
          const classes1 = new Set(elPattern.classPatterns);
          const classes2 = new Set(sibPattern.classPatterns);
          if (classes1.size > 0 || classes2.size > 0) {
            let intersection = 0;
            for (const cls of classes1) {
              if (classes2.has(cls)) intersection++;
            }
            const union = classes1.size + classes2.size - intersection;
            similarity += (intersection / union) * 0.3;
          } else {
            similarity += 0.3;
          }

          // Child structure similarity (30%)
          if (elPattern.childStructure === sibPattern.childStructure) {
            similarity += 0.3;
          }

          totalSimilarity += similarity;
        }

        const avgSimilarity = totalSimilarity / samplesToCheck.length;

        // Check if parent uses grid/flex layout
        const parentStyle = getComputedStyle(parent);
        let gridLikelihood = 0.3;
        if (parentStyle.display.includes('grid')) {
          gridLikelihood = 1.0;
        } else if (parentStyle.display.includes('flex')) {
          gridLikelihood = 0.8;
        }

        return {
          count: siblings.length,
          similarityScore: avgSimilarity,
          gridLikelihood
        };
      })()
    `;
  }

  /**
   * Generate script to find repeating patterns among candidates
   */
  getPatternGroupingScript(selectors: string[]): string {
    return `
      (function() {
        const selectors = ${JSON.stringify(selectors)};
        const patternGroups = {};

        const analyzer = window.__structuralAnalyzer;
        if (!analyzer) {
          // Return each selector in its own group if analyzer not available
          selectors.forEach((sel, i) => {
            patternGroups['group_' + i] = [sel];
          });
          return patternGroups;
        }

        // Get pattern for each element
        for (const selector of selectors) {
          try {
            const el = document.querySelector(selector);
            if (!el) continue;

            const pattern = analyzer.getStructuralPattern(el);

            if (!patternGroups[pattern.hash]) {
              patternGroups[pattern.hash] = [];
            }
            patternGroups[pattern.hash].push(selector);
          } catch (e) {
            // Invalid selector, skip
          }
        }

        return patternGroups;
      })()
    `;
  }

  /**
   * Generate script to check if two elements are structurally similar
   */
  getSimilarityScript(selector1: string, selector2: string): string {
    return `
      (function() {
        const el1 = document.querySelector(${JSON.stringify(selector1)});
        const el2 = document.querySelector(${JSON.stringify(selector2)});

        if (!el1 || !el2) return 0;

        const analyzer = window.__structuralAnalyzer;
        if (!analyzer) return 0.5;

        const pattern1 = analyzer.getStructuralPattern(el1);
        const pattern2 = analyzer.getStructuralPattern(el2);

        let similarity = 0;

        // Tag path similarity (40%)
        const maxPathLen = Math.max(pattern1.tagPath.length, pattern2.tagPath.length);
        if (maxPathLen > 0) {
          let pathMatches = 0;
          for (let i = 0; i < Math.min(pattern1.tagPath.length, pattern2.tagPath.length); i++) {
            if (pattern1.tagPath[i] === pattern2.tagPath[i]) pathMatches++;
          }
          similarity += (pathMatches / maxPathLen) * 0.4;
        } else {
          similarity += 0.4;
        }

        // Class pattern similarity (30%)
        const classes1 = new Set(pattern1.classPatterns);
        const classes2 = new Set(pattern2.classPatterns);
        if (classes1.size > 0 || classes2.size > 0) {
          let intersection = 0;
          for (const cls of classes1) {
            if (classes2.has(cls)) intersection++;
          }
          const union = classes1.size + classes2.size - intersection;
          similarity += (intersection / union) * 0.3;
        } else {
          similarity += 0.3;
        }

        // Child structure similarity (30%)
        if (pattern1.childStructure === pattern2.childStructure) {
          similarity += 0.3;
        }

        return similarity;
      })()
    `;
  }
}
