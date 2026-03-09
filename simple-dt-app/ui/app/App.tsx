import { Page } from "@dynatrace/strato-components-preview/layouts";
import React from "react";
import { Route, Routes } from "react-router-dom";
import { PortugalRoadMap } from "./pages/PortugalRoadMap";

export const App = () => {
  return (
    <Page>
      <Page.Main>
        <Routes>
          <Route path="/" element={<PortugalRoadMap />} />
        </Routes>
      </Page.Main>
    </Page>
  );
};
