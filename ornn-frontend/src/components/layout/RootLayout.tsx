import { Outlet } from "react-router-dom";
import { Navbar } from "./Navbar";
import { ToastContainer } from "@/components/ui/Toast";

export function RootLayout() {
  return (
    <div className="flex flex-col h-screen bg-bg-deep bg-grid overflow-hidden">
      <Navbar />
      <main className="flex-1 min-h-0 px-6 sm:px-10 overflow-hidden">
        <Outlet />
      </main>
      <ToastContainer />
    </div>
  );
}
