// Detect process descriptions with no conversation-specific information.
export function isGenericSummary(text) {
  const value = String(text ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
  return (
    /^(?:a )?(?:brief |short )?(?:factual )?summary of (?:the )?(?:provided )?(?:conversation(?: excerpts)?|messages|transcript)[.!]?$/i.test(
      value,
    ) ||
    /^user and assistant messages were analy[sz]ed for durable facts(?:, extracted from the provided conversation)?[.!]?$/i.test(
      value,
    )
  );
}
