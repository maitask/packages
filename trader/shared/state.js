export function buildDefaultPaperState() {
    return {
        balance: 10000,
        positions: [],
        orders: [],
        equityCurve: [],
        lastMarkPrice: null,
        marks: {},
    };
}
