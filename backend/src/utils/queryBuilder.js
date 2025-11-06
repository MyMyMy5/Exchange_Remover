const DEFAULT_QUERY = 'kind:email';

const escapeValue = (value) => value.replace(/"/g, '\\"');

const toDatePart = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().split('T')[0];
};

const buildAqsQuery = ({
  sender,
  subject,
  body,
  keywords,
  receivedFrom,
  receivedTo,
  hasAttachments,
  importance
}) => {
  const clauses = [];

  if (sender) {
    clauses.push(`from:"${escapeValue(sender)}"`);
  }

  if (subject) {
    clauses.push(`subject:"${escapeValue(subject)}"`);
  }

  if (body) {
    clauses.push(`body:"${escapeValue(body)}"`);
  }

  if (keywords && keywords.length) {
    const keywordString = keywords
      .filter(Boolean)
      .map((word) => `"${escapeValue(word)}"`)
      .join(' AND ');
    if (keywordString) {
      clauses.push(keywordString);
    }
  }

  const receivedAfter = toDatePart(receivedFrom);
  if (receivedAfter) {
    clauses.push(`received>=${receivedAfter}`);
  }

  const receivedBefore = toDatePart(receivedTo);
  if (receivedBefore) {
    clauses.push(`received<=${receivedBefore}`);
  }

  if (typeof hasAttachments === 'boolean') {
    clauses.push(`hasattachment:${hasAttachments}`);
  }

  if (importance) {
    clauses.push(`importance:${importance.toLowerCase()}`);
  }

  return clauses.length ? clauses.join(' AND ') : DEFAULT_QUERY;
};

module.exports = {
  buildAqsQuery
};
