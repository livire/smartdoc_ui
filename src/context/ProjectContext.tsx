import React, { createContext, useContext, useState } from "react";

interface Project {
  user_project_id: number;
  user_id: number;
  project_id: number;
}

interface ProjectContextType {
  project: Project | null;
  setProject: (project: Project) => void;
  clearProject: () => void;
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

export const ProjectProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Read at first render, not in an effect afterwards. An effect meant every
  // screen drew once with no project — "Go to Project Selection", an empty
  // sidebar, a blank header — and then again with the real one a frame
  // later. The value is in the browser already; there is nothing to wait
  // for.
  const [project, setProjectState] = useState<Project | null>(() => {
    try {
      const stored = localStorage.getItem("selected_project");
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const setProject = (proj: Project) => {
    setProjectState(proj);
    localStorage.setItem("selected_project", JSON.stringify(proj));
  };

  const clearProject = () => {
    setProjectState(null);
    localStorage.removeItem("selected_project");
  };

  return (
    <ProjectContext.Provider value={{ project, setProject, clearProject }}>
      {children}
    </ProjectContext.Provider>
  );
};

export const useProject = () => {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error("useProject must be used within ProjectProvider");
  }
  return context;
};
