export type PowerOverview = {
  generationKw: number;
  consumptionKw: number;
  netKw: number;
};

export function buildPowerCards(power: PowerOverview) {
  return [
    { label: "Generation", value: power.generationKw.toFixed(1), unit: "kW", tone: "purple" },
    { label: "Consumption", value: power.consumptionKw.toFixed(1), unit: "kW", tone: "blue" },
    { label: "Net power", value: `${power.netKw >= 0 ? "+" : ""}${power.netKw.toFixed(1)}`, unit: "kW", tone: power.netKw >= 0 ? "green" : "red" },
  ] as const;
}
