export const weekdayNumber = (date) => {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
};
