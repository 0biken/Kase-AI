"""
Controller -> service walk for FastAPI.

THE DIVERGENCE FROM NESTJS
--------------------------
Nest injects through a constructor:

    constructor(private readonly invoiceService: InvoiceService) {}
    -> resolve from the CONSTRUCTOR PARAMETER's declared type

FastAPI injects through the handler signature:

    def find_one(..., service: InvoiceService = Depends(get_invoice_service))
    -> resolve from the HANDLER PARAMETER's annotation

Different syntactic location, identical strategy: the DECLARED TYPE is the
resolution key, and it is available without a type checker or an import
graph. Parity holds.
"""

import ast
import os
from dataclasses import dataclass, field
from typing import Optional

MAX_DEPTH = 4


@dataclass
class SourceLocation:
    file: str
    enclosing_symbol: str        # 'InvoiceService.find' — the stable key
    line: int


@dataclass
class CallEdge:
    from_symbol: str
    to_symbol: str
    via: str                     # the injected parameter, e.g. 'service'
    location: SourceLocation


@dataclass
class CodeMapEntry:
    handler_symbol: str
    handler_location: SourceLocation
    chain: list[CallEdge] = field(default_factory=list)
    reachable_symbols: list[str] = field(default_factory=list)


class CodeMap:
    def __init__(self, root: str):
        self.root = os.path.abspath(root)
        self._modules: dict[str, ast.Module] = {}
        self._files: dict[str, str] = {}
        self._load()

    # ---------------------------------------------------------------- load
    def _load(self) -> None:
        for dirpath, dirnames, filenames in os.walk(self.root):
            dirnames[:] = [d for d in dirnames if d not in {"__pycache__", ".venv", "node_modules"}]
            for fn in filenames:
                if not fn.endswith(".py"):
                    continue
                full = os.path.join(dirpath, fn)
                rel = os.path.relpath(full, self.root).replace(os.sep, "/")
                try:
                    src = open(full, encoding="utf-8").read()
                    self._modules[rel] = ast.parse(src)
                    self._files[rel] = src
                except (SyntaxError, UnicodeDecodeError):
                    continue

    # ------------------------------------------------------------- lookups
    def _find_class(self, name: str) -> Optional[tuple[str, ast.ClassDef]]:
        for rel, tree in self._modules.items():
            for node in tree.body:
                if isinstance(node, ast.ClassDef) and node.name == name:
                    return rel, node
        return None

    def _find_method(self, cls: ast.ClassDef, name: str) -> Optional[ast.FunctionDef]:
        for node in cls.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
                return node
        return None

    def _find_function(self, module_rel: str, name: str) -> Optional[ast.FunctionDef]:
        tree = self._modules.get(module_rel)
        if not tree:
            return None
        for node in tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
                return node
        return None

    # ------------------------------------------------------------ analysis
    @staticmethod
    def _annotated_params(fn: ast.FunctionDef) -> dict[str, str]:
        """
        Maps parameter name -> annotated class name.

        Covers both FastAPI idioms:
            service: InvoiceService = Depends(get_invoice_service)
            service: Annotated[InvoiceService, Depends(get_invoice_service)]
        """
        out: dict[str, str] = {}
        args = fn.args
        for arg in [*args.posonlyargs, *args.args, *args.kwonlyargs]:
            ann = arg.annotation
            if ann is None:
                continue
            name = CodeMap._type_name(ann)
            if name:
                out[arg.arg] = name
        return out

    @staticmethod
    def _type_name(ann: ast.expr) -> Optional[str]:
        if isinstance(ann, ast.Name):
            return ann.id
        # Annotated[InvoiceService, Depends(...)] -> take the first arg
        if isinstance(ann, ast.Subscript):
            base = ann.value
            if isinstance(base, ast.Name) and base.id == "Annotated":
                sl = ann.slice
                inner = sl.elts[0] if isinstance(sl, ast.Tuple) and sl.elts else sl
                return CodeMap._type_name(inner)
        if isinstance(ann, ast.Attribute):
            return ann.attr
        return None

    def _method_location(self, rel: str, class_name: str, method: ast.FunctionDef) -> SourceLocation:
        return SourceLocation(
            file=rel,
            enclosing_symbol=f"{class_name}.{method.name}",
            line=method.lineno,
        )

    def build_for_handler(self, module_rel: str, function_name: str) -> Optional[CodeMapEntry]:
        handler = self._find_function(module_rel, function_name)
        if handler is None:
            return None

        handler_symbol = f"{module_rel.removesuffix('.py').replace('/', '.')}.{function_name}"
        handler_location = SourceLocation(
            file=module_rel, enclosing_symbol=handler_symbol, line=handler.lineno
        )

        chain: list[CallEdge] = []
        reachable = {handler_symbol}

        def walk(fn: ast.FunctionDef, from_symbol: str, params: dict[str, str], depth: int) -> None:
            if depth > MAX_DEPTH:
                return

            for node in ast.walk(fn):
                if not isinstance(node, ast.Call):
                    continue
                func = node.func
                if not isinstance(func, ast.Attribute):
                    continue

                receiver = func.value
                # `service.find(...)` where `service` is an annotated param,
                # or `self.x.find(...)` inside a service method.
                if isinstance(receiver, ast.Name):
                    param_name = receiver.id
                elif (
                    isinstance(receiver, ast.Attribute)
                    and isinstance(receiver.value, ast.Name)
                    and receiver.value.id == "self"
                ):
                    param_name = receiver.attr
                else:
                    continue

                target_class = params.get(param_name)
                if not target_class:
                    continue

                found = self._find_class(target_class)
                if not found:
                    continue
                target_rel, target_cls = found

                target_method = self._find_method(target_cls, func.attr)
                if target_method is None:
                    continue

                location = self._method_location(target_rel, target_class, target_method)
                to_symbol = location.enclosing_symbol
                if to_symbol in reachable:
                    continue

                reachable.add(to_symbol)
                chain.append(
                    CallEdge(
                        from_symbol=from_symbol,
                        to_symbol=to_symbol,
                        via=param_name,
                        location=location,
                    )
                )

                walk(target_method, to_symbol, self._annotated_params(target_method), depth + 1)

        walk(handler, handler_symbol, self._annotated_params(handler), 0)

        return CodeMapEntry(
            handler_symbol=handler_symbol,
            handler_location=handler_location,
            chain=chain,
            reachable_symbols=sorted(reachable),
        )

    def build_for_routes(self, routes) -> dict[str, CodeMapEntry]:
        out: dict[str, CodeMapEntry] = {}
        for route in routes:
            module_rel = route.handler_module.replace(".", "/") + ".py"
            entry = self.build_for_handler(module_rel, route.handler_function)
            if entry:
                out[route.handler_symbol] = entry
        return out
