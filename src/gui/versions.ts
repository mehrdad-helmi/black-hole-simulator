import type { GUI } from 'lil-gui';

export const versionNames = {
	schwarzschild: 'Schwarzschild Model',
	assertionDisk: 'Schwarzschild + Assertion Disk + Hot Gas',
	rotationModel: 'Rotation Model',
};

const versions = {
	schwarzschild: () => window.location.replace('./'),
	assertionDisk: () => window.location.replace('./v2'),
	rotationModel: () => window.location.replace('./v3'),
};

export function addVersionFolder(gui: GUI) {
	const versionsGui = gui.addFolder('Versions');
	versionsGui.add(versions, 'schwarzschild').name(versionNames.schwarzschild);
	versionsGui.add(versions, 'assertionDisk').name(versionNames.assertionDisk);
	versionsGui.add(versions, 'rotationModel').name(versionNames.rotationModel);
}
