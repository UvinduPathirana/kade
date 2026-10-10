const lkr = new Intl.NumberFormat("en-LK", { maximumFractionDigits: 0 });

/** Format an amount in Sri Lankan rupees, the way Kadé writes prices: "Rs 1,150". */
export function formatRs(amount: number): string {
  return `Rs ${lkr.format(Math.round(amount))}`;
}

/** "1 item" / "3 items" */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
