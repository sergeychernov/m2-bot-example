export function withCheckmark(selected: boolean, label: string) {
    return `${selected ? '✅' : '☐'} ${label}`;
}
