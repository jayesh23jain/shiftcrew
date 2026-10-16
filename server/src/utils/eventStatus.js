// Event lifecycle: Draft -> Published -> Ongoing -> Completed -> Settled (or Cancelled)
export const EVENT_STATUSES = ['draft', 'published', 'ongoing', 'completed', 'settled', 'cancelled'];

const TRANSITIONS = {
  draft: ['published', 'cancelled'],
  published: ['draft', 'ongoing', 'cancelled'],
  ongoing: ['completed', 'cancelled'],
  completed: ['settled'],
  settled: [],
  cancelled: [],
};

export const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);
export const isEditable = (status) => ['draft', 'published'].includes(status);
export const isPubliclyListed = (status) => ['published', 'ongoing', 'completed'].includes(status);
