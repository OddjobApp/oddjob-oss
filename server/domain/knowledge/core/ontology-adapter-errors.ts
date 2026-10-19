export class UnfilterablePropertyError extends Error {
    constructor(property: string, filterable: string[]) {
        super(
            `Property '${property}' cannot be filtered on this Object Type. ` +
                `Filterable: ${filterable.join(", ") || "(none)"}.`,
        );
        this.name = "UnfilterablePropertyError";
    }
}

