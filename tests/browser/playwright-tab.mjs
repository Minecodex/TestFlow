// The shared harness uses CUA's timeoutMs spelling; Playwright expects timeout.
export function playwrightTab(page) {
  const cache = new WeakMap();
  const adaptOptions = (value) => {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      !("timeoutMs" in value)
    )
      return value;
    const { timeoutMs, ...options } = value;
    return { ...options, timeout: timeoutMs };
  };
  const wrap = (target) => {
    if (cache.has(target)) return cache.get(target);
    const proxy = new Proxy(target, {
      get(object, property) {
        // HeroUI's native input is visually hidden; Space exercises its public keyboard interaction.
        if (
          ["check", "uncheck"].includes(property) &&
          typeof object.isChecked === "function"
        )
          return async (options) => {
            const expected = property === "check";
            if ((await object.isChecked()) !== expected)
              await object.press("Space", adaptOptions(options));
            if ((await object.isChecked()) !== expected)
              throw Error(
                "Checkbox keyboard interaction did not update selection",
              );
          };
        const value = Reflect.get(object, property, object);
        if (typeof value !== "function") return value;
        return (...args) => {
          const result = value.apply(object, args.map(adaptOptions));
          return result &&
            typeof result === "object" &&
            typeof result.getByRole === "function" &&
            typeof result.click === "function"
            ? wrap(result)
            : result;
        };
      },
    });
    cache.set(target, proxy);
    return proxy;
  };
  return {
    playwright: wrap(page),
    reload: () => page.reload(),
    goto: (url) => page.goto(url),
    url: async () => page.url(),
    click: (xy) => page.mouse.click(...xy),
    drag: async (from, to) => {
      await page.mouse.move(...from);
      await page.mouse.down();
      await page.mouse.move(...to, { steps: 20 });
      await page.mouse.up();
    },
  };
}
