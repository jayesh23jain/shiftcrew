// All money is integer paise. Never use floats for amounts.
export const durationMinutes = (start, end) => Math.round((new Date(end) - new Date(start)) / 60000);

// Estimated pay for a full shift (used for budget estimates)
export function estimatePay({ payType, rate, start, end }) {
  if (payType === 'flat') return rate;
  if (payType === 'hourly') return Math.round((rate * durationMinutes(start, end)) / 60);
  return 0;
}

// Actual pay for minutes worked
export function payForMinutes({ payType, rate }, minutes) {
  if (minutes <= 0) return 0;
  if (payType === 'flat') return rate;
  if (payType === 'hourly') return Math.round((rate * minutes) / 60);
  return 0;
}

export const feeFor = (amount, percent) => Math.round((amount * percent) / 100);
export const rupees = (paise) => `Rs ${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
export const hoursText = (minutes) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
