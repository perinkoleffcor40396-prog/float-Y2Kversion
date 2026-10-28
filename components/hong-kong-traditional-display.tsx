"use client";

import { useEffect } from "react";
import OpenCC from "opencc-js";

const convertToHongKongTraditional = OpenCC.Converter({ from: "cn", to: "hkp" });
const SKIP_SELECTOR =
  "script, style, noscript, textarea, input, select, option, pre, code, svg, math, [contenteditable='true'], [data-no-opencc], .ignore-opencc";
const CONVERTIBLE_ATTRIBUTES = ["placeholder", "title", "aria-label", "alt"];

function shouldSkipElement(element: Element | null): boolean {
  return Boolean(element?.closest(SKIP_SELECTOR));
}

function convertTextNode(node: Text) {
  if (!node.nodeValue || shouldSkipElement(node.parentElement)) return;
  const converted = convertToHongKongTraditional(node.nodeValue);
  if (converted !== node.nodeValue) node.nodeValue = converted;
}

function convertAttributes(element: Element) {
  if (shouldSkipElement(element)) return;
  for (const name of CONVERTIBLE_ATTRIBUTES) {
    const value = element.getAttribute(name);
    if (!value) continue;
    const converted = convertToHongKongTraditional(value);
    if (converted !== value) element.setAttribute(name, converted);
  }
}

function convertSubtree(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) {
    convertTextNode(root as Text);
    return;
  }

  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
  if (root instanceof Element) {
    if (shouldSkipElement(root)) return;
    convertAttributes(root);
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) convertTextNode(node as Text);

  if (root instanceof Element) {
    root.querySelectorAll("*").forEach(convertAttributes);
  }
}

export function HongKongTraditionalDisplay() {
  useEffect(() => {
    const root = document.body;
    if (!root) return;

    // Convert only rendered DOM text. Form values, editable fields, and source data remain untouched.
    convertSubtree(root);

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "characterData") {
          convertTextNode(record.target as Text);
          continue;
        }

        if (record.type === "attributes" && record.target instanceof Element) {
          convertAttributes(record.target);
          continue;
        }

        for (const addedNode of Array.from(record.addedNodes)) convertSubtree(addedNode);
      }
    });

    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: CONVERTIBLE_ATTRIBUTES,
    });

    return () => observer.disconnect();
  }, []);

  return null;
}
