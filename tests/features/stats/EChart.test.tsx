import { expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { EChart } from "../../../src/features/stats/EChart";

const init = vi.hoisted(() =>
  vi.fn(() => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(), on: vi.fn(), off: vi.fn(), isDisposed: () => false })),
);
vi.mock("../../../src/features/stats/echarts-setup", () => ({ echarts: { init } }));
vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });

it("disposes the chart instance when unmounted", () => {
  const { unmount } = render(<EChart option={{}} />);
  const firstChart = init.mock.results[0]!.value;
  expect(init).toHaveBeenLastCalledWith(expect.anything(), null, expect.objectContaining({ locale: "EN" }));
  unmount();
  expect(firstChart.dispose).toHaveBeenCalledOnce();
});
