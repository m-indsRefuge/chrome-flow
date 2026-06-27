export function createTimelineEvent(type, message) {
  return {
    eventId: crypto.randomUUID(),
    type: type,
    message: message,
    createdAt: new Date().toISOString()
  };
}
