#!/usr/bin/env python3
"""
Fast HTTP-based scraper using requests + BeautifulSoup4.
Falls back to browser if results are insufficient.
"""

import json
import sys
from typing import Optional, Dict, List, Any
import requests
from bs4 import BeautifulSoup

TIMEOUT = 10  # seconds
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"


class HttpScraper:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Cache-Control': 'max-age=0',
        })

    def scrape(self, url: str, selectors: Dict[str, Any], target_count: int) -> Dict[str, Any]:
        """
        Attempt HTTP scrape with given selectors.

        Returns:
            {
                "success": bool,
                "items": [...],
                "count": int,
                "needs_browser": bool,  # True if fallback needed
                "reason": str  # Why browser is needed (if applicable)
            }
        """
        try:
            response = self.session.get(url, timeout=TIMEOUT, allow_redirects=True)
            response.raise_for_status()

            # Check for common bot detection responses
            if self._is_bot_blocked(response):
                return {
                    "success": False,
                    "items": [],
                    "count": 0,
                    "needs_browser": True,
                    "reason": "bot_detection"
                }

            soup = BeautifulSoup(response.text, 'html.parser')
            items = self._extract_items(soup, selectors)

            count = len(items)

            # Determine if we need browser fallback
            if count == 0:
                return {
                    "success": False,
                    "items": [],
                    "count": 0,
                    "needs_browser": True,
                    "reason": "no_items_found"
                }
            elif count < target_count:
                return {
                    "success": True,
                    "items": items,
                    "count": count,
                    "needs_browser": True,
                    "reason": f"below_target_{count}/{target_count}"
                }
            else:
                return {
                    "success": True,
                    "items": items,
                    "count": count,
                    "needs_browser": False,
                    "reason": None
                }

        except requests.Timeout:
            return {
                "success": False,
                "items": [],
                "count": 0,
                "needs_browser": True,
                "reason": "timeout"
            }
        except requests.RequestException as e:
            return {
                "success": False,
                "items": [],
                "count": 0,
                "needs_browser": True,
                "reason": f"request_error: {str(e)}"
            }
        except Exception as e:
            return {
                "success": False,
                "items": [],
                "count": 0,
                "needs_browser": True,
                "reason": f"parse_error: {str(e)}"
            }

    def _is_bot_blocked(self, response: requests.Response) -> bool:
        """Check if the response indicates bot detection."""
        text_lower = response.text.lower()

        # Common bot detection indicators
        bot_indicators = [
            'captcha',
            'cloudflare',
            'access denied',
            'robot check',
            'please verify you are human',
            'enable javascript',
            'browser check',
            'ddos protection',
        ]

        for indicator in bot_indicators:
            if indicator in text_lower:
                return True

        # Check for very short responses (likely blocked)
        if len(response.text) < 500:
            return True

        return False

    def _extract_items(self, soup: BeautifulSoup, selectors: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Extract product items using CSS selectors from config."""
        items = []

        # Get product container selector - check multiple possible keys
        container_sel = (
            selectors.get('productContainer') or
            selectors.get('container') or
            selectors.get('product_container')
        )

        if not container_sel:
            return items

        # Handle both string and dict selector formats
        if isinstance(container_sel, dict):
            container_sel = container_sel.get('selector', '')

        if not container_sel:
            return items

        containers = soup.select(container_sel)

        for container in containers:
            item = {}

            # Extract each field using selectors
            for field, selector in selectors.items():
                # Skip container fields
                if field in ('productContainer', 'container', 'product_container'):
                    continue

                sel = ''
                attr = 'text'

                if isinstance(selector, dict):
                    sel = selector.get('selector', '')
                    attr = selector.get('attribute', 'text')
                elif isinstance(selector, str):
                    sel = selector
                    attr = 'text'
                else:
                    continue

                if not sel:
                    continue

                element = container.select_one(sel)
                if element:
                    if attr == 'text' or attr == 'innerText':
                        item[field] = element.get_text(strip=True)
                    elif attr == 'href':
                        item[field] = element.get('href', '')
                    elif attr == 'src':
                        item[field] = element.get('src', '')
                    elif attr == 'innerHTML':
                        item[field] = str(element)
                    else:
                        item[field] = element.get(attr, '')

            # Only add if we extracted at least one meaningful field
            if item and any(v for v in item.values() if v):
                items.append(item)

        return items


def serve():
    """
    Persistent server mode for Node.js worker pool.
    Reads JSON requests from stdin, writes JSON responses to stdout.
    Much faster than spawning new process per request (~300ms -> ~10ms).
    """
    scraper = HttpScraper()

    # Read lines from stdin continuously
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)

            # Handle shutdown command
            if request.get('command') == 'shutdown':
                break

            url = request.get('url', '')
            selectors = request.get('selectors', {})
            target_count = request.get('targetCount', 10)

            if not url:
                result = {
                    "success": False,
                    "items": [],
                    "count": 0,
                    "needs_browser": True,
                    "reason": "missing_url"
                }
            else:
                result = scraper.scrape(url, selectors, target_count)

            # Output result as single JSON line
            print(json.dumps(result), flush=True)

        except json.JSONDecodeError as e:
            print(json.dumps({
                "success": False,
                "items": [],
                "count": 0,
                "needs_browser": True,
                "reason": f"json_decode_error: {str(e)}"
            }), flush=True)
        except Exception as e:
            print(json.dumps({
                "success": False,
                "items": [],
                "count": 0,
                "needs_browser": True,
                "reason": f"worker_error: {str(e)}"
            }), flush=True)


def main():
    """CLI interface for Node.js to call (legacy single-request mode)."""
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: http_scraper.py <json_input> OR http_scraper.py --serve"}))
        sys.exit(1)

    # Check for server mode
    if sys.argv[1] == '--serve':
        serve()
        return

    try:
        input_data = json.loads(sys.argv[1])
        url = input_data['url']
        selectors = input_data['selectors']
        target_count = input_data.get('targetCount', 10)

        scraper = HttpScraper()
        result = scraper.scrape(url, selectors, target_count)

        print(json.dumps(result))

    except json.JSONDecodeError as e:
        print(json.dumps({
            "success": False,
            "items": [],
            "count": 0,
            "needs_browser": True,
            "reason": f"json_decode_error: {str(e)}"
        }))
        sys.exit(1)
    except KeyError as e:
        print(json.dumps({
            "success": False,
            "items": [],
            "count": 0,
            "needs_browser": True,
            "reason": f"missing_key: {str(e)}"
        }))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({
            "success": False,
            "items": [],
            "count": 0,
            "needs_browser": True,
            "reason": f"fatal_error: {str(e)}"
        }))
        sys.exit(1)


if __name__ == '__main__':
    main()
