/**
 * ESLint Rule: Enforce Design Tokens
 * 
 * This rule enforces the use of design tokens instead of hardcoded values:
 * - Colors: Use var(--color-*) instead of hex/rgb values
 * - Spacing: Use var(--spacing-*) instead of pixel values
 * - Typography: Use var(--font-*) instead of hardcoded fonts/sizes
 * 
 * Exceptions:
 * - Files in 3D graph/Monaco contexts (documented in docs/design-system-exceptions.md)
 * - Test files
 * - Storybook files
 */

export default {
  meta: {
    type: "suggestion",
    docs: {
      description: "Enforce use of design tokens instead of hardcoded values",
      category: "Best Practices",
      recommended: false,
    },
    schema: [
      {
        type: "object",
        properties: {
          allowedFiles: {
            type: "array",
            items: { type: "string" },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      useColorToken: "Use design token var(--color-*) instead of hardcoded color '{{value}}'",
      useSpacingToken: "Use design token var(--spacing-*) instead of hardcoded spacing '{{value}}'",
      useFontToken: "Use design token var(--font-*) instead of hardcoded font value '{{value}}'",
      useRadiusToken: "Use design token var(--radius-*) instead of hardcoded radius '{{value}}'",
    },
  },
  create(context) {
    const options = context.options[0] || {};
    const allowedFiles = options.allowedFiles || [
      "**/3d/**",
      "**/monaco/**",
      "**/*.test.{ts,tsx}",
      "**/*.stories.{ts,tsx}",
      "**/eslint-rules/**",
    ];

    const filename = context.getFilename();
    const isAllowed = allowedFiles.some((pattern) => {
      const regex = new RegExp(pattern.replace(/\*/g, ".*"));
      return regex.test(filename);
    });

    if (isAllowed) {
      return {};
    }

    // Regex patterns for hardcoded values
    const hexColorRegex = /#[0-9a-fA-F]{3,8}/g;
    const rgbColorRegex = /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*[\d.]+)?\s*\)/g;
    const pixelSpacingRegex = /\b\d+px\b/g;
    const remSpacingRegex = /\b\d+rem\b/g;
    const emSpacingRegex = /\b\d+em\b/g;
    const hardcodedFontRegex = /font-family:\s*[^;]+(?![^;]*var\(--font-)/g;
    const hardcodedRadiusRegex = /border-radius:\s*[^;]+(?![^;]*var\(--radius-)/g;

    function checkStyleObject(node) {
      if (node.type !== "ObjectExpression") return;

      node.properties.forEach((property) => {
        // Spread elements (`...base`) have no value node to check.
        if (!property.value || property.value.type !== "Literal") return;
        const value = property.value.value;

        if (typeof value !== "string") return;

        // Check for hex colors
        const hexMatches = value.match(hexColorRegex);
        hexMatches?.forEach((match) => {
          context.report({
            node: property.value,
            messageId: "useColorToken",
            data: { value: match },
          });
        });

        // Check for rgb/rgba colors
        const rgbMatches = value.match(rgbColorRegex);
        rgbMatches?.forEach((match) => {
          context.report({
            node: property.value,
            messageId: "useColorToken",
            data: { value: match },
          });
        });

        // Check for pixel spacing (but allow 0px and 1px for borders)
        const pixelMatches = value.match(pixelSpacingRegex);
        pixelMatches?.forEach((match) => {
          if (match !== "0px" && match !== "1px") {
            context.report({
              node: property.value,
              messageId: "useSpacingToken",
              data: { value: match },
            });
          }
        });

        // Check for rem/em spacing
        const remMatches = value.match(remSpacingRegex);
        remMatches?.forEach((match) => {
          context.report({
            node: property.value,
            messageId: "useSpacingToken",
            data: { value: match },
          });
        });

        const emMatches = value.match(emSpacingRegex);
        emMatches?.forEach((match) => {
          if (match !== "1em") {
            context.report({
              node: property.value,
              messageId: "useSpacingToken",
              data: { value: match },
            });
          }
        });

        // Check for hardcoded fonts
        const fontMatches = value.match(hardcodedFontRegex);
        fontMatches?.forEach((match) => {
          context.report({
            node: property.value,
            messageId: "useFontToken",
            data: { value: match },
          });
        });

        // Check for hardcoded border-radius
        const radiusMatches = value.match(hardcodedRadiusRegex);
        radiusMatches?.forEach((match) => {
          context.report({
            node: property.value,
            messageId: "useRadiusToken",
            data: { value: match },
          });
        });
      });
    }

    return {
      // Check style objects in React components
      Property(node) {
        if (node.key.name === "style" && node.value.type === "ObjectExpression") {
          checkStyleObject(node.value);
        }
      },
      // Check style objects in variable declarations
      VariableDeclarator(node) {
        if (node.init && node.init.type === "ObjectExpression") {
          checkStyleObject(node.init);
        }
      },
    };
  },
};
